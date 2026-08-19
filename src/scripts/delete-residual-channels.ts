/**
 * src/scripts/delete-residual-channels.ts
 *
 * Elimina los sales channels que quedaron como residuo del armado inicial:
 * "Default Sales Channel" y "TIENDA HITAIR COLOMBIA". Ninguno tiene productos
 * ni llave publicable; los storefronts usan "TIENDA EKIVIBE COLOMBIA" y
 * "Hit-Air Colombia".
 *
 * NO borra a ciegas. Antes de eliminar cada canal verifica que:
 *   1. No tenga productos enlazados.
 *   2. No tenga ninguna llave publicable (ningun storefront lo consume).
 *   3. No tenga pedidos asociados.
 *   4. No sea el default_sales_channel_id de la tienda. Medusa protege ese
 *      canal a nivel de nucleo y lanza error; "Default Sales Channel" lo es.
 * Si alguna verificacion falla, ese canal se omite y se reporta el motivo.
 *
 * Cada canal se elimina en su propia llamada: agrupados en una sola, el
 * rechazo de uno tumba la transaccion y no se borra ninguno.
 *
 * Lo que NO se toca: productos, precios, Wompi, opciones de envio, Envia.com,
 * inventario ni los dos canales en uso. Eliminar un canal vacio solo remueve
 * el canal y su vinculo con la stock location.
 *
 * DRY_RUN=true por defecto.
 *
 * Uso, desde /app en el contenedor de Railway:
 *   DRY_RUN=true  npx medusa exec ./src/scripts/delete-residual-channels.ts
 *   DRY_RUN=false npx medusa exec ./src/scripts/delete-residual-channels.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { deleteSalesChannelsWorkflow } from "@medusajs/medusa/core-flows"

const A_ELIMINAR = ["Default Sales Channel", "TIENDA HITAIR COLOMBIA"]

export default async function deleteResidualChannels({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const DRY_RUN = process.env.DRY_RUN !== "false"
  logger.info("")
  logger.info(
    `=== CANALES RESIDUO — ${DRY_RUN ? "DRY_RUN (simulacion)" : "APLICACION REAL"} ===`
  )

  const { data: canales } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })

  // Canal por defecto de la tienda: Medusa impide borrarlo.
  let defaultIds: string[] = []
  try {
    const { data: stores } = await query.graph({
      entity: "store",
      fields: ["id", "name", "default_sales_channel_id"],
    })
    defaultIds = (stores as any[])
      .map((st) => st.default_sales_channel_id)
      .filter(Boolean)
  } catch {
    logger.warn("  No se pudo leer la tienda; se omite la verificacion de canal por defecto.")
  }
  const { data: llaves } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "sales_channels.id"],
  })
  const { data: productos } = await query.graph({
    entity: "product",
    fields: ["id", "title", "sales_channels.id"],
  })

  let pedidos: any[] = []
  try {
    const res = await query.graph({
      entity: "order",
      fields: ["id", "sales_channel_id"],
    })
    pedidos = res.data as any[]
  } catch {
    logger.warn("  No se pudieron leer pedidos; se omite esa verificacion.")
  }

  const borrar: { id: string; name: string }[] = []

  for (const nombre of A_ELIMINAR) {
    const c: any = (canales as any[]).find((x) => x.name === nombre)
    if (!c) {
      logger.warn(`  "${nombre}": no existe, nada que hacer.`)
      continue
    }

    const conProductos = (productos as any[]).filter((p) =>
      (p.sales_channels || []).some((sc: any) => sc.id === c.id)
    )
    const conLlaves = (llaves as any[]).filter((k) =>
      (k.sales_channels || []).some((sc: any) => sc.id === c.id)
    )
    const conPedidos = pedidos.filter((o) => o.sales_channel_id === c.id)

    logger.info("")
    logger.info(`  ${c.name}  [${c.id}]`)
    logger.info(`    productos : ${conProductos.length}`)
    logger.info(`    llaves    : ${conLlaves.length}`)
    logger.info(`    pedidos   : ${conPedidos.length}`)

    const motivos: string[] = []
    if (conProductos.length) {
      motivos.push(`tiene ${conProductos.length} productos`)
    }
    if (conLlaves.length) {
      motivos.push(`lo usa ${conLlaves.map((k) => k.title).join(", ")}`)
    }
    if (conPedidos.length) {
      motivos.push(`tiene ${conPedidos.length} pedidos`)
    }
    if (defaultIds.includes(c.id)) {
      motivos.push(
        "es el canal por defecto de la tienda (Medusa no permite borrarlo; " +
          "para eliminarlo habria que asignar otro como default en Settings > Store)"
      )
    }

    if (motivos.length) {
      logger.warn(`    -> NO se elimina: ${motivos.join("; ")}`)
      continue
    }
    logger.info("    -> seguro de eliminar")
    borrar.push({ id: c.id, name: c.name })
  }

  logger.info("")
  if (!borrar.length) {
    logger.info("Ningun canal cumple las condiciones para eliminarse.")
    return
  }

  if (DRY_RUN) {
    logger.info(
      `[simulacion] se eliminarian: ${borrar.map((b) => b.name).join(", ")}`
    )
    logger.info(
      "Para aplicar: DRY_RUN=false npx medusa exec ./src/scripts/delete-residual-channels.ts"
    )
    return
  }

  // Uno por uno: si uno falla, los demas igual se procesan.
  let ok = 0
  for (const b of borrar) {
    try {
      await deleteSalesChannelsWorkflow(container).run({ input: { ids: [b.id] } })
      logger.info(`  eliminado: ${b.name}`)
      ok++
    } catch (err: any) {
      logger.error(`  fallo "${b.name}": ${err?.message}`)
    }
  }
  logger.info("")
  logger.info(`${ok} de ${borrar.length} canales eliminados.`)
  logger.info("Verifica con: npx medusa exec ./src/scripts/audit-sales-channels.ts")
}
