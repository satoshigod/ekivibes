/**
 * src/scripts/audit-inventory-titles.ts
 *
 * Compara los tres titulos que existen por cada SKU:
 *
 *   producto        -> lo que ve el cliente en la tienda
 *   variante        -> la opcion (talla, color)
 *   inventory item  -> lo que aparece en la columna Title de Admin > Inventory
 *
 * Son campos distintos. La pantalla de Inventory muestra el tercero, y cuando
 * el inventory item se creo sin titulo propio, Medusa cae de vuelta al nombre
 * de la variante: por eso algunos SKU se ven como "M" o "Negro / M" en vez de
 * un nombre descriptivo.
 *
 * Solo lectura.
 *
 * Uso, desde /app en el contenedor de Railway:
 *   npx medusa exec ./src/scripts/audit-inventory-titles.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function auditInventoryTitles({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "title", "variants.title", "variants.product.title"],
  })

  logger.info("")
  logger.info("=== TITULOS POR SKU ===")
  logger.info("")
  logger.info(
    "  SKU".padEnd(18) +
      "PRODUCTO".padEnd(42) +
      "VARIANTE".padEnd(18) +
      "INVENTORY ITEM"
  )
  logger.info("  " + "-".repeat(100))

  const sinTitulo: string[] = []

  for (const it of items as any[]) {
    const v = (it.variants || [])[0]
    const prod = v?.product?.title || "(sin producto)"
    const varTitle = v?.title || "-"
    const itemTitle = it.title || "(VACIO -> muestra la variante)"
    if (!it.title) {
      sinTitulo.push(it.sku)
    }
    logger.info(
      "  " +
        String(it.sku || "?").padEnd(16) +
        String(prod).slice(0, 40).padEnd(42) +
        String(varTitle).slice(0, 16).padEnd(18) +
        itemTitle
    )
  }

  logger.info("")
  if (sinTitulo.length) {
    logger.warn(
      `${sinTitulo.length} inventory items SIN titulo propio. En Admin > Inventory ` +
        `se ven con el nombre de la variante:`
    )
    logger.warn("  " + sinTitulo.join(", "))
    logger.info("")
    logger.info(
      "Esto es cosmetico: no afecta la tienda, el stock ni los pedidos. " +
        "El cliente siempre ve el titulo del PRODUCTO."
    )
  } else {
    logger.info("Todos los inventory items tienen titulo propio.")
  }

  logger.info("")
  logger.info(`Resumen: ${items.length} inventory items.`)
}
