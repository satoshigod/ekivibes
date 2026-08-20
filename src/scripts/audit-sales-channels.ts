/**
 * src/scripts/audit-sales-channels.ts
 *
 * Verifica que cada canal de venta exponga SOLO los productos de su marca.
 *
 * El vinculo producto <-> canal es lo que separa los catalogos. El vinculo
 * canal <-> stock location solo decide de que bodega sale el stock. Son
 * independientes: consolidar bodegas no mezcla catalogos.
 *
 * Correr ANTES y DESPUES de consolidar y comparar: las listas de productos
 * por canal deben quedar identicas.
 *
 * NOTA TECNICA: la relacion se consulta desde el lado del producto. En
 * Medusa v2 el campo sales_channel.products no resuelve por query.graph y
 * devuelve listas vacias, lo que hace parecer que ningun canal tiene
 * catalogo.
 *
 * Solo lectura.
 *
 * Uso, desde /app en el contenedor de Railway:
 *   npx medusa exec ./src/scripts/audit-sales-channels.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

function segmento(skus: string[]): string {
  const moto = /^(MLV2|HDS|MX9|EU7|WIRE)/i
  const equi = /^(VH|MLV-|KEY|LANYARD)/i
  // CO2 es accesorio universal Hit-Air (recarga chalecos y chaquetas de
  // ambos segmentos) — vinculado a Ekivibes Y Hit-Air Colombia desde el
  // 20-ago-2026 a proposito. No cuenta para el aviso de MEZCLADO.
  const compartido = /^CO2/i
  let m = 0
  let e = 0
  let c = 0
  for (const s of skus) {
    if (moto.test(s)) m++
    else if (equi.test(s)) e++
    else if (compartido.test(s)) c++
  }
  const extra = c ? ` + ${c} compartido` : ""
  if (m && e) return `MEZCLADO (${m} moto, ${e} equitacion${extra})`
  if (m) return `moto (${m} variantes${extra})`
  if (e) return `equitacion (${e} variantes${extra})`
  if (c) return `compartido (${c} variantes)`
  return "sin clasificar"
}

export default async function auditSalesChannels({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: canales } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "stock_locations.id", "stock_locations.name"],
  })

  const { data: llaves } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "token", "type", "sales_channels.id"],
  })

  // Se consulta desde el producto: es la direccion que si resuelve.
  const { data: productos } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "status",
      "variants.sku",
      "sales_channels.id",
      "sales_channels.name",
    ],
  })

  const porCanal = new Map<string, any[]>()
  const huerfanos: any[] = []
  for (const p of productos as any[]) {
    const cs = p.sales_channels || []
    if (!cs.length) {
      huerfanos.push(p)
      continue
    }
    for (const c of cs) {
      const arr = porCanal.get(c.id) || []
      arr.push(p)
      porCanal.set(c.id, arr)
    }
  }

  logger.info("")
  logger.info("=== CATALOGO POR CANAL DE VENTA ===")

  for (const c of canales as any[]) {
    const ps = porCanal.get(c.id) || []
    const skus: string[] = []
    for (const p of ps) {
      for (const v of p.variants || []) {
        if (v.sku) skus.push(v.sku)
      }
    }

    logger.info("")
    logger.info(`  ${c.name}   [${c.id}]`)
    logger.info(`    productos : ${ps.length}   -> ${segmento(skus)}`)

    const ubic = (c.stock_locations || []).map((l: any) => l.name)
    logger.info(`    bodegas   : ${ubic.length ? ubic.join(", ") : "NINGUNA"}`)

    const suyas = (llaves as any[]).filter((k) =>
      (k.sales_channels || []).some((sc: any) => sc.id === c.id)
    )
    if (!suyas.length) {
      logger.warn("    llave      : NINGUNA (ningun storefront usa este canal)")
    }
    for (const k of suyas) {
      logger.info(`    llave      : ${k.title}  ${String(k.token).slice(0, 18)}...`)
    }

    for (const p of ps) {
      const s = (p.variants || [])
        .map((v: any) => v.sku)
        .filter(Boolean)
        .join(", ")
      const est = p.status !== "published" ? ` (${p.status})` : ""
      logger.info(`       - ${p.title}${est}  [${s}]`)
    }
  }

  logger.info("")
  logger.info("=== REVISION ===")
  let hallazgos = 0

  for (const c of canales as any[]) {
    const ps = porCanal.get(c.id) || []
    const skus: string[] = []
    for (const p of ps) {
      for (const v of p.variants || []) {
        if (v.sku) skus.push(v.sku)
      }
    }
    const seg = segmento(skus)
    // Un canal sin llave publicable es interno (venta directa, mostrador):
    // ahi mezclar marcas es lo correcto. La regla aplica a tiendas web.
    const esInterno = !(llaves as any[]).some((k) =>
      (k.sales_channels || []).some((sc: any) => sc.id === c.id)
    )
    if (seg.startsWith("MEZCLADO") && !esInterno) {
      logger.error(`  "${c.name}" MEZCLA moto y equitacion: ${seg}`)
      hallazgos++
    } else if (seg.startsWith("MEZCLADO")) {
      logger.info(`  "${c.name}" mezcla marcas, pero es canal interno sin llave: correcto.`)
    }
    const conLlave = (llaves as any[]).some((k) =>
      (k.sales_channels || []).some((sc: any) => sc.id === c.id)
    )
    if (!ps.length && !conLlave) {
      logger.warn(`  "${c.name}" sin productos y sin llave: residuo, se puede eliminar.`)
      hallazgos++
    }
  }

  if (huerfanos.length) {
    logger.warn(`  ${huerfanos.length} productos sin canal de venta (invisibles en tienda):`)
    for (const p of huerfanos) {
      logger.warn(`     - ${p.title}`)
    }
    hallazgos++
  }

  if (!hallazgos) {
    logger.info("  Todo correcto: catalogos separados, sin residuos ni huerfanos.")
  }

  logger.info("")
  logger.info(`Resumen: ${canales.length} canales, ${productos.length} productos.`)
}
