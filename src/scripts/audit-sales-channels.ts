/**
 * src/scripts/audit-sales-channels.ts
 *
 * Verifica que cada canal de venta muestre SOLO los productos de su marca.
 *
 * El vinculo producto <-> canal es lo que separa los catalogos. El vinculo
 * canal <-> stock location solo decide de que bodega sale el stock. Son
 * independientes: consolidar bodegas no mezcla catalogos.
 *
 * Este script lo comprueba. Correr ANTES y DESPUES de consolidar y comparar:
 * las listas de productos por canal deben quedar identicas.
 *
 * Reporta por canal: llaves publicables, ubicaciones enlazadas y productos.
 *
 * Solo lectura.
 *
 * Uso, desde /app en el contenedor de Railway:
 *   npx medusa exec ./src/scripts/audit-sales-channels.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/** Clasifica por SKU para detectar mezclas entre marcas. */
function segmento(skus: string[]): string {
  const moto = /^(MLV2|HDS|MX9|EU7|WIRE)/i
  const equi = /^(VH|MLV-|CO2|KEY|LANYARD)/i
  let m = 0
  let e = 0
  for (const s of skus) {
    if (moto.test(s)) m++
    else if (equi.test(s)) e++
  }
  if (m && e) return `MEZCLADO (${m} moto, ${e} equitacion)`
  if (m) return `moto (${m})`
  if (e) return `equitacion (${e})`
  return "sin clasificar"
}

export default async function auditSalesChannels({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: canales } = await query.graph({
    entity: "sales_channel",
    fields: [
      "id",
      "name",
      "products.id",
      "products.title",
      "products.variants.sku",
      "stock_locations.id",
      "stock_locations.name",
    ],
  })

  const { data: llaves } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "token", "type", "sales_channels.id"],
  })

  logger.info("")
  logger.info("=== CATALOGO POR CANAL DE VENTA ===")

  for (const c of canales as any[]) {
    const productos = c.products || []
    const skus: string[] = []
    for (const p of productos) {
      for (const v of p.variants || []) {
        if (v.sku) skus.push(v.sku)
      }
    }

    logger.info("")
    logger.info(`  ${c.name}   [${c.id}]`)
    logger.info(`    productos : ${productos.length}   -> ${segmento(skus)}`)

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

    for (const p of productos) {
      const s = (p.variants || [])
        .map((v: any) => v.sku)
        .filter(Boolean)
        .join(", ")
      logger.info(`       - ${p.title}  [${s}]`)
    }
  }

  logger.info("")
  logger.info("=== REVISION ===")
  const vacios = (canales as any[]).filter((c) => !(c.products || []).length)
  for (const c of vacios) {
    logger.warn(`  "${c.name}" no tiene productos: candidato a eliminar.`)
  }
  const mezclados = (canales as any[]).filter((c) => {
    const skus: string[] = []
    for (const p of c.products || []) {
      for (const v of p.variants || []) {
        if (v.sku) skus.push(v.sku)
      }
    }
    return segmento(skus).startsWith("MEZCLADO")
  })
  for (const c of mezclados) {
    logger.error(`  "${c.name}" MEZCLA moto y equitacion. Revisar vinculos de producto.`)
  }
  if (!vacios.length && !mezclados.length) {
    logger.info("  Sin canales vacios ni mezclados.")
  }
}
