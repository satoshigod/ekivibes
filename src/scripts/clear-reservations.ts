/**
 * src/scripts/clear-reservations.ts
 *
 * Limpia las reservas de inventario (columna "Reserved" en el Admin) que
 * quedaron de las pruebas de carrito/checkout de hoy, para que Ivan pueda
 * hacer una ronda de "una orden por producto" y ver el Reserved subir de
 * 0 -> 1 limpiamente por cada SKU.
 *
 * NO toca `stocked_quantity` (el "In stock"), solo las reservas.
 * NO borra órdenes ni carritos — solo el registro de reserva de inventario.
 *
 * SEGURIDAD:
 *  - DRY_RUN=true (default): solo lista lo que hay, no borra nada.
 *  - Marca con ⚠️ cualquier reserva cuyo line_item pertenezca a una ORDEN
 *    real (no solo un carrito abandonado), para que se revise antes de
 *    borrarla si se corre en DRY_RUN=false.
 *
 * EJECUCIÓN:
 *   DRY_RUN=true  npx medusa exec ./src/scripts/clear-reservations.ts
 *   DRY_RUN=false npx medusa exec ./src/scripts/clear-reservations.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function clearReservations({ container }: ExecArgs) {
  const DRY_RUN = process.env.DRY_RUN !== "false"

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventoryModuleService = container.resolve(Modules.INVENTORY)

  const log = (msg: string) => logger.info(msg)

  log("=".repeat(70))
  log(`LIMPIEZA DE RESERVAS — MODO: ${DRY_RUN ? "DRY_RUN (solo lista)" : "APLICACIÓN REAL"}`)
  log("=".repeat(70))

  // Mapa inventory_item_id -> sku, para que el reporte sea legible.
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
  })
  const itemIdToSku = new Map((items as any[]).map((i) => [i.id, i.sku ?? "(sin sku)"]))

  // Set de line_item_id que pertenecen a una ORDEN real (no solo carrito),
  // para advertir antes de borrar una reserva de una compra ya hecha.
  const orderLineItemIds = new Set<string>()
  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "items.id"],
    })
    for (const o of orders as any[]) {
      for (const it of o.items ?? []) {
        orderLineItemIds.add(it.id)
      }
    }
  } catch (e) {
    log(`  ⚠️  No se pudo verificar qué reservas pertenecen a órdenes reales: ${e instanceof Error ? e.message : String(e)}`)
  }

  const reservations = await inventoryModuleService.listReservationItems({})
  log(`\n${reservations.length} reserva(s) activa(s) encontrada(s).\n`)

  let ordersFlagged = 0
  for (const r of reservations as any[]) {
    const belongsToOrder = r.line_item_id && orderLineItemIds.has(r.line_item_id)
    if (belongsToOrder) ordersFlagged++
    log(
      `  - sku="${itemIdToSku.get(r.inventory_item_id) ?? "(desconocido)"}" qty=${r.quantity} ` +
        `line_item_id=${r.line_item_id ?? "(ninguno)"} creada=${r.created_at} ` +
        `${belongsToOrder ? "⚠️  PERTENECE A UNA ORDEN REAL" : ""}`
    )
  }

  if (ordersFlagged > 0) {
    log(`\n⚠️  ${ordersFlagged} de las reservas pertenecen a una orden ya creada (no solo un carrito de prueba abandonado).`)
  }

  if (reservations.length === 0) {
    log("\nNada que limpiar.")
    return
  }

  if (!DRY_RUN) {
    await inventoryModuleService.deleteReservationItems((reservations as any[]).map((r) => r.id))
    log(`\n✅ ${reservations.length} reserva(s) eliminada(s). El stock ("In stock") no se tocó, solo el "Reserved".`)
  } else {
    log(`\n[DRY_RUN] Se eliminarían las ${reservations.length} reserva(s) de arriba.`)
  }

  log("\n" + "=".repeat(70))
}
