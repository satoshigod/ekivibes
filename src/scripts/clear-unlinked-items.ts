/**
 * src/scripts/clear-unlinked-items.ts
 *
 * Borra CUALQUIER InventoryItem que no esté vinculado a ninguna variante,
 * sin importar su nombre/SKU ni su stock. Es el criterio más completo y
 * seguro de "esto es basura": si no está pegado a nada, no puede afectar
 * el catálogo ni el checkout.
 *
 * Esto complementa a normalize-store.ts (Fase 4b), que solo detecta
 * basura por prefijos de nombre conocidos (sweep-, fix-, inv-v6-, etc.)
 * y por eso no atrapa huérfanos con nombres "limpios" mal habidos
 * (ej. MLV-ADU-M-clean, VH-NINOS-XS-FINAL) ni items sin SKU en absoluto.
 *
 * DRY_RUN=true por defecto (solo lista, no borra).
 *
 * EJECUCIÓN:
 *   DRY_RUN=true  npx medusa exec ./src/scripts/clear-unlinked-items.ts
 *   DRY_RUN=false npx medusa exec ./src/scripts/clear-unlinked-items.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function clearUnlinkedItems({ container }: ExecArgs) {
  const DRY_RUN = process.env.DRY_RUN !== "false"

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventoryModuleService = container.resolve(Modules.INVENTORY)

  const log = (msg: string) => logger.info(msg)

  log("=".repeat(70))
  log(`LIMPIEZA DE ITEMS SIN VÍNCULO — MODO: ${DRY_RUN ? "DRY_RUN (solo lista)" : "APLICACIÓN REAL"}`)
  log("=".repeat(70))

  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "title", "variants.id", "location_levels.stocked_quantity"],
  })

  const unlinked = (items as any[]).filter((item) => (item.variants ?? []).length === 0)

  log(`\n${items.length} inventory item(s) totales. ${unlinked.length} sin ningún vínculo.\n`)

  for (const item of unlinked) {
    const stock = (item.location_levels ?? []).reduce((s: number, l: any) => s + (l.stocked_quantity ?? 0), 0)
    log(`  - sku="${item.sku ?? "(sin sku)"}" title="${item.title ?? "(sin título)"}" stock=${stock} (${item.id})`)
  }

  if (unlinked.length === 0) {
    log("\nNada que limpiar — todos los items están vinculados a alguna variante.")
    return
  }

  if (!DRY_RUN) {
    await inventoryModuleService.deleteInventoryItems(unlinked.map((i) => i.id))
    log(`\n✅ ${unlinked.length} inventory item(s) sin vínculo eliminado(s).`)
  } else {
    log(`\n[DRY_RUN] Se eliminarían los ${unlinked.length} item(s) listados arriba.`)
  }

  log("\n" + "=".repeat(70))
}
