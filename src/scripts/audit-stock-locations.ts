/**
 * src/scripts/audit-stock-locations.ts
 *
 * Audita las ubicaciones de stock y donde vive realmente el inventario.
 *
 * Responde tres preguntas:
 *   1. Cuantas stock locations existen y como se llaman.
 *   2. Para cada SKU, en que ubicaciones tiene nivel y con cuantas unidades.
 *   3. Que SKUs no tienen nivel en ninguna parte (invisibles para vender).
 *
 * Uso, desde /app en el contenedor de Railway:
 *   npx medusa exec ./src/scripts/audit-stock-locations.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function auditStockLocations({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name", "address.city"],
  })

  logger.info("")
  logger.info("=== UBICACIONES DE STOCK ===")
  for (const l of locations) {
    logger.info(`  ${l.id}  ${l.name}`)
  }
  if (locations.length > 1) {
    logger.warn(
      `  ATENCION: hay ${locations.length} ubicaciones. Si solo operas una bodega, ` +
        `las demas son residuo y pueden estar reteniendo stock invisible.`
    )
  }

  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: [
      "id",
      "sku",
      "location_levels.location_id",
      "location_levels.stocked_quantity",
      "location_levels.reserved_quantity",
    ],
  })

  const nombre = new Map(locations.map((l: any) => [l.id, l.name]))
  const porUbicacion = new Map<string, { unidades: number; skus: number }>()
  const sinNivel: string[] = []

  logger.info("")
  logger.info("=== INVENTARIO POR SKU ===")
  for (const it of items) {
    const niveles = (it as any).location_levels || []
    if (!niveles.length) {
      sinNivel.push(`${it.sku || "(sin sku)"} [${it.id}]`)
      continue
    }
    const detalle = niveles
      .map((n: any) => {
        const acc = porUbicacion.get(n.location_id) || { unidades: 0, skus: 0 }
        acc.unidades += Number(n.stocked_quantity) || 0
        acc.skus += 1
        porUbicacion.set(n.location_id, acc)
        const donde = nombre.get(n.location_id) || n.location_id
        const res = Number(n.reserved_quantity) || 0
        return `${donde}=${n.stocked_quantity}${res ? ` (res ${res})` : ""}`
      })
      .join("  |  ")
    logger.info(`  ${(it.sku || "(sin sku)").padEnd(16)} ${detalle}`)
  }

  logger.info("")
  logger.info("=== TOTALES POR UBICACION ===")
  for (const [locId, acc] of porUbicacion) {
    logger.info(
      `  ${(nombre.get(locId) || locId).toString().padEnd(28)} ` +
        `${acc.skus} SKUs, ${acc.unidades} unidades   [${locId}]`
    )
  }

  if (sinNivel.length) {
    logger.info("")
    logger.warn(`=== ${sinNivel.length} SKUs SIN NIVEL EN NINGUNA UBICACION ===`)
    logger.warn("  Estos no se pueden vender ni ajustar hasta crearles nivel:")
    for (const s of sinNivel) {
      logger.warn(`    ${s}`)
    }
  }

  logger.info("")
  logger.info(
    `Resumen: ${locations.length} ubicaciones, ${items.length} inventory items, ` +
      `${sinNivel.length} sin nivel.`
  )
}
