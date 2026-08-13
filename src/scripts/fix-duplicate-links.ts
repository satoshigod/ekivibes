/**
 * src/scripts/fix-duplicate-links.ts
 *
 * Medusa v2 permite que una ProductVariant tenga MÁS DE UN InventoryItem
 * vinculado a la vez (la relación es hasMany en ambos lados — pensada para
 * "inventory kits"/bundles). El script de normalización de ayer solo
 * revisó y resolvió UN item en conflicto por variante; si alguna variante
 * tenía dos o más items basura vinculados a la vez (no solo uno), el
 * segundo quedó pegado sin detectarse — y por eso recibe reserva cada vez
 * que se pide la variante "oficial" (Medusa reparte/duplica la reserva
 * entre TODOS los items vinculados).
 *
 * Este script:
 *  1. Para cada una de las 15 variantes reales, lista TODOS sus
 *     InventoryItems vinculados (no solo uno).
 *  2. Si hay más de uno, conserva el que tiene el SKU oficial y
 *     desvincula (link.dismiss) los demás, sin importar su nombre.
 *  3. Borra cualquier reserva activa que haya quedado en los items
 *     desvinculados (son reservas fantasma, no corresponden a un pedido
 *     real completo — solo al duplicado del vínculo).
 *  4. NO borra los InventoryItems desvinculados en este mismo run —
 *     quedan huérfanos, listos para que normalize-store.ts (Fase 4b) los
 *     limpie en su próxima corrida, igual que el resto de la basura.
 *
 * DRY_RUN=true por defecto (solo audita, no toca nada).
 *
 * EJECUCIÓN:
 *   DRY_RUN=true  npx medusa exec ./src/scripts/fix-duplicate-links.ts
 *   DRY_RUN=false npx medusa exec ./src/scripts/fix-duplicate-links.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const PRODUCT_SKU_CONFIG: Record<string, { sizeMap?: Record<string, string>; fixedSku?: string }> = {
  "Chaleco Airbag VH (Juvenil / Adulto)": {
    sizeMap: { S: "VH-ADU-S", M: "VH-ADU-M", L: "VH-ADU-L" },
  },
  "Chaleco Airbag MLV3-H (Juvenil / Adulto)": {
    sizeMap: { XS: "MLV-ADU-XS", S: "MLV-ADU-S", M: "MLV-ADU-M", L: "MLV-ADU-L" },
  },
  "Lanyard Bungee All-in-One Hit-Air": {
    sizeMap: { XS: "LANYARD-XS", S: "LANYARD-S", L: "LANYARD-L" },
  },
  "Chaleco Airbag VH Niños": { fixedSku: "VH-NIN-XS" },
  "Chaleco Airbag MLV3-H Niños": { fixedSku: "MLV-NIN-2XS" },
  "Cartucho de CO2 Hit-Air 50cc": { fixedSku: "CO2-50CC" },
  "Cartucho de CO2 Hit-Air 60cc": { fixedSku: "CO2-60CC" },
  "Llave de Resina Tipo B Hit-Air": { fixedSku: "KEY-RESIN" },
}

const normalizeSizeLabel = (s?: string | null) =>
  (s ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()

const resolveTargetSku = (productTitle: string, variantTitle?: string | null): string | null => {
  const cfg = PRODUCT_SKU_CONFIG[productTitle]
  if (!cfg) return null
  if (cfg.fixedSku) return cfg.fixedSku
  if (cfg.sizeMap) return cfg.sizeMap[normalizeSizeLabel(variantTitle)] ?? null
  return null
}

export default async function fixDuplicateLinks({ container }: ExecArgs) {
  const DRY_RUN = process.env.DRY_RUN !== "false"

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const inventoryModuleService = container.resolve(Modules.INVENTORY)

  const log = (msg: string) => logger.info(msg)

  log("=".repeat(70))
  log(`AUDITORÍA DE VÍNCULOS DUPLICADOS — MODO: ${DRY_RUN ? "DRY_RUN (solo audita)" : "APLICACIÓN REAL"}`)
  log("=".repeat(70))

  // Mapa variant_id -> InventoryItem[] (TODOS los vinculados, no solo uno).
  const { data: allItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "variants.id"],
  })
  const variantIdToItems = new Map<string, any[]>()
  for (const item of allItems as any[]) {
    for (const v of item.variants ?? []) {
      const list = variantIdToItems.get(v.id) ?? []
      list.push(item)
      variantIdToItems.set(v.id, list)
    }
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "variants.id", "variants.title", "variants.sku"],
  })

  let extrasFound = 0
  let extrasFixed = 0

  for (const p of products as any[]) {
    for (const v of p.variants ?? []) {
      const targetSku = resolveTargetSku(p.title, v.title)
      if (!targetSku) continue

      const linked = variantIdToItems.get(v.id) ?? []
      if (linked.length <= 1) {
        log(`  ✅ "${p.title}" [${targetSku}]: 1 solo item vinculado (${linked[0]?.id ?? "ninguno"}). OK.`)
        continue
      }

      extrasFound += linked.length - 1
      log(`  ⚠️  "${p.title}" [${targetSku}]: ${linked.length} items vinculados a la vez:`)
      for (const it of linked) {
        log(`       - ${it.id} (sku="${it.sku ?? "null"}")${it.sku === targetSku ? "  <- oficial, se conserva" : "  <- extra, se desvincula"}`)
      }

      const official = linked.find((it) => it.sku === targetSku) ?? linked[0]
      const extras = linked.filter((it) => it.id !== official.id)

      for (const extra of extras) {
        if (!DRY_RUN) {
          await link.dismiss({
            [Modules.PRODUCT]: { variant_id: v.id },
            [Modules.INVENTORY]: { inventory_item_id: extra.id },
          })
          // Borrar cualquier reserva fantasma que haya quedado en el item extra.
          const reservations = await inventoryModuleService.listReservationItems({
            inventory_item_id: extra.id,
          })
          if (reservations.length > 0) {
            await inventoryModuleService.deleteReservationItems(reservations.map((r: any) => r.id))
            log(`     -> ✅ Desvinculado ${extra.id} y ${reservations.length} reserva(s) fantasma borrada(s).`)
          } else {
            log(`     -> ✅ Desvinculado ${extra.id} (sin reservas pendientes).`)
          }
          extrasFixed++
        } else {
          log(`     -> [DRY_RUN] Se desvincularía ${extra.id} y se borrarían sus reservas si las tuviera.`)
        }
      }
    }
  }

  log("\n" + "=".repeat(70))
  log(`REPORTE: ${extrasFound} vínculo(s) extra encontrado(s)${!DRY_RUN ? `, ${extrasFixed} corregido(s)` : ""}.`)
  if (extrasFound > 0 && DRY_RUN) {
    log("Corre con DRY_RUN=false para aplicar. Los items desvinculados NO se borran en este script")
    log("— quedan huérfanos para que normalize-store.ts (Fase 4b) los limpie en su próxima corrida.")
  }
  log("=".repeat(70))
}
