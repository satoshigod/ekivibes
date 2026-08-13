/**
 * src/scripts/clear-zero-stock-items.ts
 *
 * Borra los InventoryItems que tienen 0 unidades en TODAS las bodegas
 * (el "In stock" que se ve en 0 en el Admin). Antes de borrar cada uno,
 * verifica que no esté vinculado a ninguna de las 15 variantes reales
 * (por seguridad — un item con 0 stock vinculado a una variante real
 * sería un problema aparte, no basura, y no se toca).
 *
 * NO borra items con stock > 0, aunque tengan nombre de basura — eso lo
 * cubre normalize-store.ts (Fase 4b) por prefijo, y fix-duplicate-links.ts
 * por vínculo duplicado.
 *
 * DRY_RUN=true por defecto (solo lista, no borra).
 *
 * EJECUCIÓN:
 *   DRY_RUN=true  npx medusa exec ./src/scripts/clear-zero-stock-items.ts
 *   DRY_RUN=false npx medusa exec ./src/scripts/clear-zero-stock-items.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function clearZeroStockItems({ container }: ExecArgs) {
  const DRY_RUN = process.env.DRY_RUN !== "false"

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const inventoryModuleService = container.resolve(Modules.INVENTORY)

  const log = (msg: string) => logger.info(msg)

  log("=".repeat(70))
  log(`LIMPIEZA DE ITEMS CON 0 STOCK — MODO: ${DRY_RUN ? "DRY_RUN (solo lista)" : "APLICACIÓN REAL"}`)
  log("=".repeat(70))

  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: [
      "id",
      "sku",
      "variants.id",
      "location_levels.stocked_quantity",
    ],
  })

  const zeroStockItems = (items as any[]).filter((item) => {
    const total = (item.location_levels ?? []).reduce(
      (sum: number, l: any) => sum + (l.stocked_quantity ?? 0),
      0
    )
    return total === 0
  })

  log(`\n${items.length} inventory item(s) totales. ${zeroStockItems.length} con 0 stock.\n`)

  let deletedCount = 0
  for (const item of zeroStockItems) {
    const linkedVariants = item.variants ?? []
    if (linkedVariants.length > 0) {
      log(
        `  ⚠️  "${item.sku ?? "(sin sku)"}" (${item.id}): tiene 0 stock PERO está vinculado a ${linkedVariants.length} variante(s) (${linkedVariants.map((v: any) => v.id).join(", ")}). NO se borra — requiere revisión manual.`
      )
      continue
    }

    log(`  - "${item.sku ?? "(sin sku)"}" (${item.id}): 0 stock, sin vínculos. Se borra.`)
    if (!DRY_RUN) {
      await inventoryModuleService.deleteInventoryItems(item.id)
      deletedCount++
    }
  }

  log("\n" + "=".repeat(70))
  if (!DRY_RUN) {
    log(`✅ ${deletedCount} inventory item(s) con 0 stock eliminado(s).`)
  } else {
    log(`[DRY_RUN] Se eliminarían los items listados arriba (los marcados con ⚠️ NO, por seguridad).`)
  }
  log("=".repeat(70))
}
