/**
 * src/scripts/audit-location-links.ts
 *
 * Muestra que tiene colgando cada stock location antes de decidir cual
 * consolidar. Borrar una ubicacion arrastra sus opciones de envio y sus
 * vinculos de canal de venta, asi que esto se mira ANTES de tocar nada.
 *
 * Reporta:
 *   1. Canales de venta enlazados a cada ubicacion.
 *   2. Fulfillment sets y service zones de cada ubicacion.
 *   3. Reservas activas por ubicacion, con el pedido que las origino.
 *
 * Solo lectura.
 *
 * Uso, desde /app en el contenedor de Railway:
 *   npx medusa exec ./src/scripts/audit-location-links.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function auditLocationLinks({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: [
      "id",
      "name",
      "sales_channels.id",
      "sales_channels.name",
      "fulfillment_sets.id",
      "fulfillment_sets.name",
      "fulfillment_sets.type",
      "fulfillment_sets.service_zones.id",
      "fulfillment_sets.service_zones.name",
      "fulfillment_sets.service_zones.shipping_options.id",
      "fulfillment_sets.service_zones.shipping_options.name",
    ],
  })

  logger.info("")
  logger.info("=== QUE TIENE COLGANDO CADA UBICACION ===")
  for (const l of locations as any[]) {
    logger.info("")
    logger.info(`  ${l.name}   [${l.id}]`)

    const canales = l.sales_channels || []
    if (!canales.length) {
      logger.warn("    canales de venta : NINGUNO (no vende por esta ubicacion)")
    } else {
      for (const c of canales) {
        logger.info(`    canal de venta   : ${c.name}  [${c.id}]`)
      }
    }

    const sets = l.fulfillment_sets || []
    if (!sets.length) {
      logger.warn("    envios           : NINGUNO (no despacha por esta ubicacion)")
    }
    for (const fs of sets) {
      logger.info(`    fulfillment set  : ${fs.name} (${fs.type})`)
      for (const z of fs.service_zones || []) {
        const ops = (z.shipping_options || []).map((o: any) => o.name).join(", ")
        logger.info(`       zona ${z.name}: ${ops || "sin opciones"}`)
      }
    }
  }

  // ---- reservas activas -----------------------------------------------
  const { data: reservas } = await query.graph({
    entity: "reservation_item",
    fields: [
      "id",
      "quantity",
      "location_id",
      "line_item_id",
      "inventory_item.sku",
    ],
  })

  const nombre = new Map((locations as any[]).map((l) => [l.id, l.name]))
  const porUbic = new Map<string, { n: number; unidades: number }>()

  logger.info("")
  logger.info("=== RESERVAS ACTIVAS ===")
  if (!reservas.length) {
    logger.info("  ninguna")
  }
  for (const r of reservas as any[]) {
    const acc = porUbic.get(r.location_id) || { n: 0, unidades: 0 }
    acc.n += 1
    acc.unidades += Number(r.quantity) || 0
    porUbic.set(r.location_id, acc)
    logger.info(
      `  ${(r.inventory_item?.sku || "?").padEnd(16)} ` +
        `${String(r.quantity).padStart(3)} uds  en ${nombre.get(r.location_id) || r.location_id}` +
        `   line_item=${r.line_item_id || "-"}`
    )
  }

  logger.info("")
  logger.info("=== RESUMEN DE RESERVAS POR UBICACION ===")
  for (const [locId, acc] of porUbic) {
    logger.info(
      `  ${(nombre.get(locId) || locId).toString().padEnd(28)} ${acc.n} reservas, ${acc.unidades} unidades`
    )
  }

  logger.info("")
  logger.info(
    "Las reservas provienen de pedidos no completados. Si son de pruebas, " +
      "cancelar esos pedidos las libera."
  )
}
