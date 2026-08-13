/**
 * src/scripts/normalize-store.ts
 *
 * NORMALIZACIÓN DE PRODUCCIÓN — EKIVIBES (Medusa v2.18.0)
 * =========================================================
 *
 * Unifica Publishable API Keys, Sales Channel, Stock Location y
 * saneamiento de inventario para dejar la tienda lista para checkout
 * real (Wompi) sin ítems fantasma.
 *
 * SEGURIDAD / DISEÑO:
 *  - DRY_RUN=true (default): solo audita e imprime lo que haría. No escribe nada.
 *  - DRY_RUN=false: aplica los cambios reales.
 *  - Cada fase está aislada en try/catch: un fallo en una fase se reporta
 *    claramente y no corrompe las fases anteriores ya aplicadas.
 *  - El saneamiento de inventario NUNCA elimina ítems huérfanos hasta
 *    confirmar que las 15 variantes reales ya tienen inventario válido.
 *  - No se inventan SKUs: si una variante no tiene SKU propio limpio,
 *    se reporta para revisión manual en vez de adivinar uno.
 *
 * EJECUCIÓN:
 *   DRY_RUN=true  npx medusa exec ./src/scripts/normalize-store.ts
 *   DRY_RUN=false npx medusa exec ./src/scripts/normalize-store.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  revokeApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  createSalesChannelsWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  linkProductsToSalesChannelWorkflow,
  updateProductVariantsWorkflow,
  createInventoryItemsWorkflow,
  createInventoryLevelsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows"

// ---------------------------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------------------------
const TARGET_KEY_TITLE = "EKIVIBE Storefront Key"
const TARGET_CHANNEL_NAME = "TIENDA EKIVIBE COLOMBIA"
const TARGET_LOCATION_NAME = "Bodega Principal"
const TARGET_STOCK_QTY = 100
const JUNK_SKU_PREFIXES = ["sweep-", "fix-", "inv-v6-", "inv-variant_"]

const isJunkSku = (sku?: string | null) => {
  if (!sku || sku.trim() === "") return true
  return JUNK_SKU_PREFIXES.some((p) => sku.startsWith(p))
}

// ---------------------------------------------------------------------------
// SKU OFICIAL POR PRODUCTO — confirmado explícitamente por Ivan (2026-08-13).
// Todos los valores son ASCII puro (sin Ñ/tildes) por requisito de compatibilidad
// con la API de Medusa v2. `sizeMap` se resuelve contra el `title` real de la
// variante en la base de datos — nunca se adivina el orden de las variantes.
// ---------------------------------------------------------------------------
type SkuConfig = { sizeMap?: Record<string, string>; fixedSku?: string }

const PRODUCT_SKU_CONFIG: Record<string, SkuConfig> = {
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

// Sanitiza a ASCII puro (mayúsculas, sin tildes/Ñ, solo A-Z0-9-) como defensa
// adicional, incluso si el valor ya viene "limpio" desde PRODUCT_SKU_CONFIG.
const toAsciiSku = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")

const normalizeSizeLabel = (s?: string | null) =>
  (s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()

// Resuelve el SKU oficial para una variante a partir del título real del
// producto y de la variante (la "talla" en Medusa vive en variant.title).
// Devuelve null si no hay match — nunca inventa un SKU a ciegas.
const resolveTargetSku = (productTitle: string, variantTitle?: string | null): string | null => {
  const cfg = PRODUCT_SKU_CONFIG[productTitle]
  if (!cfg) return null
  if (cfg.fixedSku) return toAsciiSku(cfg.fixedSku)
  if (cfg.sizeMap) {
    const key = normalizeSizeLabel(variantTitle)
    const match = cfg.sizeMap[key]
    return match ? toAsciiSku(match) : null
  }
  return null
}

export default async function normalizeStore({ container }: ExecArgs) {
  const DRY_RUN = process.env.DRY_RUN !== "false"

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL)
  const stockLocationModuleService = container.resolve(Modules.STOCK_LOCATION)
  const inventoryModuleService = container.resolve(Modules.INVENTORY)
  const apiKeyModuleService = container.resolve(Modules.API_KEY)

  const summary: string[] = []
  const errors: string[] = []
  const log = (msg: string) => {
    summary.push(msg)
    logger.info(msg)
  }
  const logErr = (phase: string, e: unknown) => {
    const msg = `  [ERROR en ${phase}]: ${e instanceof Error ? e.message : String(e)}`
    errors.push(msg)
    logger.error(msg)
  }

  log("=".repeat(78))
  log(`NORMALIZACIÓN EKIVIBES — MODO: ${DRY_RUN ? "DRY_RUN (simulación, sin escritura)" : "⚠️  APLICACIÓN REAL"}`)
  log("=".repeat(78))

  // =========================================================================
  // FASE 1: Sales Channel + Stock Location (estructura única)
  // =========================================================================
  log("\n[FASE 1] Sales Channel y Stock Location únicos")

  let salesChannel: any = null
  let stockLocation: any = null

  try {
    const existingChannels = await salesChannelModuleService.listSalesChannels({
      name: TARGET_CHANNEL_NAME,
    })
    salesChannel = existingChannels[0] ?? null

    if (!salesChannel) {
      log(`  -> Sales Channel "${TARGET_CHANNEL_NAME}" no existe.`)
      if (!DRY_RUN) {
        const { result: salesChannelResult } = await createSalesChannelsWorkflow(container).run({
          input: { salesChannelsData: [{ name: TARGET_CHANNEL_NAME }] },
        })
        salesChannel = salesChannelResult[0]
        log(`  -> ✅ Creado: ${salesChannel.id}`)
      } else {
        log(`  -> [DRY_RUN] Se crearía.`)
      }
    } else {
      log(`  -> ✅ Encontrado: ${salesChannel.id} (is_disabled=${salesChannel.is_disabled})`)
      if (salesChannel.is_disabled && !DRY_RUN) {
        await salesChannelModuleService.updateSalesChannels(salesChannel.id, {
          is_disabled: false,
        })
        log(`  -> ✅ Reactivado.`)
      }
    }

    // Desactivar (NO eliminar, por seguridad de datos históricos de órdenes)
    // cualquier otro sales channel activo, ej. "Default Sales Channel".
    const allChannels = await salesChannelModuleService.listSalesChannels({})
    const otherActiveChannels = allChannels.filter(
      (c: any) => c.name !== TARGET_CHANNEL_NAME && !c.is_disabled
    )
    for (const c of otherActiveChannels) {
      log(`  -> Canal secundario activo detectado: "${c.name}" (${c.id}). Se desactivará.`)
      if (!DRY_RUN) {
        await salesChannelModuleService.updateSalesChannels(c.id, {
          is_disabled: true,
        })
      } else {
        log(`  -> [DRY_RUN] Se desactivaría (no se elimina).`)
      }
    }
  } catch (e) {
    logErr("Sales Channel", e)
  }

  try {
    const existingLocations = await stockLocationModuleService.listStockLocations({
      name: TARGET_LOCATION_NAME,
    })
    stockLocation = existingLocations[0] ?? null

    if (!stockLocation) {
      log(`  -> Stock Location "${TARGET_LOCATION_NAME}" no existe.`)
      if (!DRY_RUN) {
        const { result: stockLocationResult } = await createStockLocationsWorkflow(container).run({
          input: { locations: [{ name: TARGET_LOCATION_NAME }] },
        })
        stockLocation = stockLocationResult[0]
        log(`  -> ✅ Creada: ${stockLocation.id}`)
      } else {
        log(`  -> [DRY_RUN] Se crearía.`)
      }
    } else {
      log(`  -> ✅ Encontrada: ${stockLocation.id}`)
    }
  } catch (e) {
    logErr("Stock Location", e)
  }

  // Vincular Bodega Principal <-> TIENDA EKIVIBE COLOMBIA
  if (salesChannel && stockLocation) {
    try {
      const { data: locWithChannels } = await query.graph({
        entity: "stock_location",
        fields: ["id", "sales_channels.id"],
        filters: { id: stockLocation.id },
      })
      const alreadyLinked = (locWithChannels[0]?.sales_channels ?? []).some(
        (sc: any) => sc.id === salesChannel.id
      )
      if (!alreadyLinked) {
        log(`  -> Vinculando "${TARGET_LOCATION_NAME}" <-> "${TARGET_CHANNEL_NAME}"`)
        if (!DRY_RUN) {
          await linkSalesChannelsToStockLocationWorkflow(container).run({
            input: { id: stockLocation.id, add: [salesChannel.id] },
          })
          log(`  -> ✅ Vinculados.`)
        } else {
          log(`  -> [DRY_RUN] Se vincularían.`)
        }
      } else {
        log(`  -> ✅ Ya vinculados.`)
      }
    } catch (e) {
      logErr("Vínculo Stock Location <-> Sales Channel", e)
    }
  } else {
    log(`  -> ⚠️  Saltando vínculo: falta Sales Channel o Stock Location (ver errores arriba).`)
  }

  // =========================================================================
  // FASE 2: Publishable API Keys (unificación)
  // =========================================================================
  log("\n[FASE 2] Publishable API Keys")

  let canonicalKey: any = null

  try {
    const allPublishableKeys = await apiKeyModuleService.listApiKeys({
      type: "publishable",
    })
    const activeKeys = allPublishableKeys.filter((k: any) => !k.revoked_at)

    log(`  -> ${allPublishableKeys.length} publishable key(s) totales, ${activeKeys.length} activa(s).`)

    canonicalKey = activeKeys.find((k: any) => k.title === TARGET_KEY_TITLE) ?? null
    const duplicateKeys = activeKeys.filter((k: any) => k.id !== canonicalKey?.id)

    if (!canonicalKey) {
      log(`  -> No existe una key activa titulada "${TARGET_KEY_TITLE}".`)
      if (!DRY_RUN) {
        const { result } = await createApiKeysWorkflow(container).run({
          input: {
            api_keys: [
              {
                title: TARGET_KEY_TITLE,
                type: "publishable",
                created_by: "normalize-store-script",
              },
            ],
          },
        })
        canonicalKey = result[0]
        log(`  -> ✅ Creada: ${canonicalKey.id}`)
      } else {
        log(`  -> [DRY_RUN] Se crearía.`)
      }
    } else {
      log(`  -> ✅ Encontrada: ${canonicalKey.id} (token: ${canonicalKey.redacted ?? canonicalKey.token})`)
    }

    if (duplicateKeys.length > 0) {
      log(`  -> ${duplicateKeys.length} key(s) duplicada(s)/en desuso a revocar:`)
      for (const dup of duplicateKeys) {
        log(`     - "${dup.title}" (${dup.id})`)
      }
      if (!DRY_RUN) {
        try {
          await revokeApiKeysWorkflow(container).run({
            input: {
              selector: { id: duplicateKeys.map((k: any) => k.id) },
              revoke: { revoked_by: "normalize-store-script" },
            },
          })
          log(`  -> ✅ Revocadas.`)
        } catch (e) {
          logErr("Revocación de keys duplicadas", e)
        }
      } else {
        log(`  -> [DRY_RUN] Se revocarían.`)
      }
    } else {
      log(`  -> No hay keys duplicadas activas.`)
    }
  } catch (e) {
    logErr("Auditoría de API Keys", e)
  }

  // Vincular la key canónica EXCLUSIVAMENTE al Sales Channel objetivo
  if (canonicalKey && salesChannel) {
    try {
      const { data: keyWithChannels } = await query.graph({
        entity: "api_key",
        fields: ["id", "sales_channels.id"],
        filters: { id: canonicalKey.id },
      })
      const linkedChannelIds: string[] = (keyWithChannels[0]?.sales_channels ?? []).map(
        (sc: any) => sc.id
      )
      const toAdd = linkedChannelIds.includes(salesChannel.id) ? [] : [salesChannel.id]
      const toRemove = linkedChannelIds.filter((id) => id !== salesChannel.id)

      if (toAdd.length || toRemove.length) {
        log(
          `  -> Ajustando vínculos de la key canónica (add: ${toAdd.length}, remove: ${toRemove.length}) para exclusividad con "${TARGET_CHANNEL_NAME}".`
        )
        if (!DRY_RUN) {
          await linkSalesChannelsToApiKeyWorkflow(container).run({
            input: { id: canonicalKey.id, add: toAdd, remove: toRemove },
          })
          log(`  -> ✅ Vínculo exclusivo aplicado.`)
        } else {
          log(`  -> [DRY_RUN] Se ajustaría.`)
        }
      } else {
        log(`  -> ✅ Ya vinculada exclusivamente al canal correcto.`)
      }
    } catch (e) {
      logErr("Vínculo API Key <-> Sales Channel", e)
    }
  }

  // =========================================================================
  // FASE 3: Catálogo — productos exclusivamente en el canal objetivo
  // =========================================================================
  log("\n[FASE 3] Normalización del catálogo")

  let realVariants: any[] = []

  try {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title", "sales_channels.id", "sales_channels.name", "variants.id", "variants.title", "variants.sku"],
    })

    log(`  -> ${products.length} producto(s) encontrado(s) (se esperaban 8).`)
    if (products.length !== 8) {
      log(`  -> ⚠️  El número de productos no coincide con lo esperado. Revisar manualmente antes de continuar.`)
    }

    for (const p of products) {
      const channelIds: string[] = (p.sales_channels ?? []).map((sc: any) => sc.id)
      const needsAdd = salesChannel && !channelIds.includes(salesChannel.id)
      const needsRemove = channelIds.filter((id) => id !== salesChannel?.id)

      if (needsAdd || needsRemove.length) {
        log(`  -> "${p.title}": add=${needsAdd ? 1 : 0}, remove=${needsRemove.length}`)
        if (!DRY_RUN && salesChannel) {
          await linkProductsToSalesChannelWorkflow(container).run({
            input: {
              id: salesChannel.id,
              add: needsAdd ? [p.id] : [],
              remove: [], // se limpia por canal más abajo si aplica
            },
          })
          // Remover de otros canales explícitamente
          for (const otherChannelId of needsRemove) {
            await linkProductsToSalesChannelWorkflow(container).run({
              input: { id: otherChannelId, add: [], remove: [p.id] },
            })
          }
        } else {
          log(`     [DRY_RUN] Se ajustaría la asociación de canal.`)
        }
      }

      for (const v of p.variants ?? []) {
        realVariants.push({ ...v, product_title: p.title })
      }
    }

    log(`  -> ${realVariants.length} variante(s) real(es) encontrada(s) (se esperaban 15).`)
    if (realVariants.length !== 15) {
      log(`  -> ⚠️  El número de variantes no coincide con lo esperado. Revisar manualmente.`)
    }
  } catch (e) {
    logErr("Normalización de catálogo", e)
  }

  // =========================================================================
  // FASE 4: Saneamiento de inventario (quirúrgico)
  // =========================================================================
  log("\n[FASE 4] Saneamiento de inventario")

  const officialInventoryItemIds = new Set<string>()
  const demotedItemIds = new Set<string>() // items desvinculados en esta corrida por conflicto de SKU -> basura confirmada, se borran en 4b pase lo que pase con su nombre
  let allVariantsHealthy = true

  if (!stockLocation) {
    log(
      `  -> ℹ️  Bodega Principal aún no existe (se crea en el mismo run cuando DRY_RUN=false). Se audita cada variante igual; la verificación/creación de NIVELES de stock queda como "se aplicaría" hasta ese momento.`
    )
  }

  // Mapa variant_id -> InventoryItem real, y mapa sku -> InventoryItem para
  // detectar conflictos (una variante puede tener MÁS DE UN item vinculado
  // por scripts de parche anteriores; el mapa por variante se queda con
  // uno solo por orden de llegada, así que el de sku se usa para encontrar
  // el "bueno" cuando el renombrado choca con un SKU que ya existe en otro item).
  // Se consulta desde el LADO del inventory_item (relación inversa `variants`):
  // product_variant.inventory_items.* devuelve el id de la fila de VÍNCULO
  // (prefijo pvitem_), no el id real del InventoryItem (prefijo iitem_).
  const variantIdToItem = new Map<string, any>()
  const skuToItem = new Map<string, any>()
  try {
    const { data: allItemsWithVariants } = await query.graph({
      entity: "inventory_item",
      fields: [
        "id",
        "sku",
        "location_levels.location_id",
        "location_levels.stocked_quantity",
        "variants.id",
      ],
    })
    for (const item of allItemsWithVariants as any[]) {
      if (item.sku) skuToItem.set(item.sku, item)
      for (const v of item.variants ?? []) {
        variantIdToItem.set(v.id, item)
      }
    }
  } catch (e) {
    logErr("Mapeo inventory_item <-> variant", e)
  }

  for (const v of realVariants) {
    try {
      // 1. Resolver el SKU oficial a partir del producto + talla real (variant.title).
      const targetSku = resolveTargetSku(v.product_title, v.title)

      if (!targetSku) {
        log(
          `  -> ⚠️  "${v.product_title}" [talla/título: "${v.title ?? "(vacío)"}", id ${v.id}]: no reconozco esta variante en el mapeo de SKUs confirmado. NO se genera nada — requiere revisión manual.`
        )
        allVariantsHealthy = false
        continue
      }

      // 2. Si el SKU actual de la variante no coincide con el oficial, renombrarlo.
      let effectiveSku = v.sku
      if (v.sku !== targetSku) {
        log(`  -> "${v.product_title}" [talla "${v.title}"]: SKU actual "${v.sku ?? "null"}" -> oficial "${targetSku}".`)
        if (!DRY_RUN) {
          await updateProductVariantsWorkflow(container).run({
            input: { product_variants: [{ id: v.id, sku: targetSku }] },
          })
          effectiveSku = targetSku
          log(`     -> ✅ SKU de la variante actualizado a "${targetSku}".`)
        } else {
          log(`     -> [DRY_RUN] Se actualizaría el SKU de la variante a "${targetSku}".`)
          effectiveSku = targetSku // para que el resto del audit razone sobre el estado post-fix
        }
      }

      // 3. Verificar/crear el inventory item + nivel de stock con el SKU oficial.
      let existingItem: any = variantIdToItem.get(v.id)

      // 3a. Si el item vinculado NO tiene ya el SKU oficial, verificar si ese SKU
      // ya lo tiene OTRO item en la base (residuo de un item bueno original que
      // un script de parche viejo no desvinculó al agregar uno de basura extra).
      if (existingItem && existingItem.sku !== targetSku) {
        const conflictItem = skuToItem.get(targetSku)
        if (conflictItem && conflictItem.id !== existingItem.id) {
          const conflictLinkedToThisVariant = (conflictItem.variants ?? []).some((cv: any) => cv.id === v.id)
          const conflictLinkedToOtherVariant =
            !conflictLinkedToThisVariant && (conflictItem.variants ?? []).length > 0

          if (conflictLinkedToOtherVariant) {
            log(
              `  -> ⚠️  "${v.product_title}" [talla "${v.title}"]: el SKU "${targetSku}" ya pertenece a otro InventoryItem (${conflictItem.id}) vinculado a OTRA variante. NO se toca — requiere revisión manual.`
            )
            allVariantsHealthy = false
            continue
          }

          // El item con el SKU oficial existe (vinculado a esta misma variante ya,
          // o huérfano) -> se adopta como el bueno; el item de basura actual se
          // desvincula para que quede huérfano y lo limpie la Fase 4b.
          log(
            `  -> "${v.product_title}" [talla "${v.title}"]: "${targetSku}" ya existe en otro InventoryItem (${conflictItem.id}, ${conflictLinkedToThisVariant ? "ya vinculado a esta variante" : "huérfano"}). Se adopta ese y se desvincula el de basura (${existingItem.id}).`
          )
          if (!DRY_RUN) {
            if (!conflictLinkedToThisVariant) {
              await link.create({
                [Modules.PRODUCT]: { variant_id: v.id },
                [Modules.INVENTORY]: { inventory_item_id: conflictItem.id },
              })
            }
            await link.dismiss({
              [Modules.PRODUCT]: { variant_id: v.id },
              [Modules.INVENTORY]: { inventory_item_id: existingItem.id },
            })
            log(`     -> ✅ Adoptado "${conflictItem.id}", desvinculado "${existingItem.id}".`)
          } else {
            log(`     -> [DRY_RUN] Se adoptaría "${conflictItem.id}" y se desvincularía "${existingItem.id}".`)
          }
          demotedItemIds.add(existingItem.id)
          existingItem = conflictItem
        }
      }

      if (existingItem) {
        officialInventoryItemIds.add(existingItem.id)

        // El inventory item puede existir con un sku desactualizado (ej. "-clean"/"-v5").
        if (existingItem.sku !== targetSku) {
          log(`  -> "${v.product_title}" [${targetSku}]: su inventory item tiene SKU desactualizado ("${existingItem.sku ?? "null"}").`)
          if (!DRY_RUN) {
            await inventoryModuleService.updateInventoryItems({ id: existingItem.id, sku: targetSku })
            log(`     -> ✅ SKU del inventory item actualizado a "${targetSku}".`)
          } else {
            log(`     -> [DRY_RUN] Se actualizaría el SKU del inventory item a "${targetSku}".`)
          }
        }

        const level = stockLocation
          ? (existingItem.location_levels ?? []).find((l: any) => l.location_id === stockLocation.id)
          : null

        if (!stockLocation) {
          log(`  -> "${v.product_title}" [${targetSku}]: inventory item OK (${existingItem.id}). Nivel en Bodega Principal se creará/verificará cuando exista la bodega.`)
        } else if (!level) {
          log(`  -> "${v.product_title}" [${targetSku}]: inventory item OK pero sin nivel en Bodega Principal.`)
          if (!DRY_RUN) {
            await createInventoryLevelsWorkflow(container).run({
              input: {
                inventory_levels: [
                  {
                    inventory_item_id: existingItem.id,
                    location_id: stockLocation.id,
                    stocked_quantity: TARGET_STOCK_QTY,
                  },
                ],
              },
            })
            log(`     -> ✅ Nivel de stock creado (${TARGET_STOCK_QTY} u.).`)
          } else {
            log(`     -> [DRY_RUN] Se crearía nivel de stock (${TARGET_STOCK_QTY} u.).`)
          }
        } else if (level.stocked_quantity <= 0) {
          log(`  -> "${v.product_title}" [${targetSku}]: stock en 0 en Bodega Principal.`)
          if (!DRY_RUN) {
            await updateInventoryLevelsWorkflow(container).run({
              input: {
                updates: [
                  {
                    inventory_item_id: existingItem.id,
                    location_id: stockLocation.id,
                    stocked_quantity: TARGET_STOCK_QTY,
                  },
                ],
              },
            })
            log(`     -> ✅ Stock actualizado a ${TARGET_STOCK_QTY} u.`)
          } else {
            log(`     -> [DRY_RUN] Se actualizaría a ${TARGET_STOCK_QTY} u.`)
          }
        } else {
          log(`  -> ✅ "${v.product_title}" [${targetSku}]: OK (${level.stocked_quantity} u. en Bodega Principal).`)
        }
        continue
      }

      // No tiene inventory item -> verificar primero si el SKU oficial ya existe
      // como item huérfano/de otra variante en algún lado (mismo caso que 3a,
      // por si en el futuro se agrega una variante sin ningún vínculo previo).
      const orphanWithTargetSku = skuToItem.get(targetSku)
      if (orphanWithTargetSku) {
        const linkedToOtherVariant = (orphanWithTargetSku.variants ?? []).length > 0
        if (linkedToOtherVariant) {
          log(
            `  -> ⚠️  "${v.product_title}" [talla "${v.title}"]: sin inventory item, pero el SKU "${targetSku}" ya pertenece a otro InventoryItem (${orphanWithTargetSku.id}) vinculado a OTRA variante. NO se crea nada — requiere revisión manual.`
          )
          allVariantsHealthy = false
          continue
        }
        log(`  -> "${v.product_title}" [talla "${v.title}"]: sin inventory item vinculado, pero "${targetSku}" ya existe como item huérfano (${orphanWithTargetSku.id}). Se vincula ese en vez de crear uno nuevo.`)
        if (!DRY_RUN) {
          await link.create({
            [Modules.PRODUCT]: { variant_id: v.id },
            [Modules.INVENTORY]: { inventory_item_id: orphanWithTargetSku.id },
          })
          log(`     -> ✅ Vinculado.`)
        } else {
          log(`     -> [DRY_RUN] Se vincularía.`)
        }
        officialInventoryItemIds.add(orphanWithTargetSku.id)
        existingItem = orphanWithTargetSku
        // Cae al bloque de arriba en la siguiente iteración lógica: como ya no
        // hay más código después de esto en esta rama, se resuelve el nivel de
        // stock igual que el resto (se re-evalúa a mano aquí, sin duplicar todo el bloque).
        const level2 = stockLocation
          ? (orphanWithTargetSku.location_levels ?? []).find((l: any) => l.location_id === stockLocation.id)
          : null
        if (stockLocation && !level2) {
          if (!DRY_RUN) {
            await createInventoryLevelsWorkflow(container).run({
              input: {
                inventory_levels: [
                  { inventory_item_id: orphanWithTargetSku.id, location_id: stockLocation.id, stocked_quantity: TARGET_STOCK_QTY },
                ],
              },
            })
            log(`     -> ✅ Nivel de stock creado (${TARGET_STOCK_QTY} u.).`)
          } else {
            log(`     -> [DRY_RUN] Se crearía nivel de stock (${TARGET_STOCK_QTY} u.).`)
          }
        }
        continue
      }

      // No tiene inventory item ni existe huérfano con ese SKU -> crear uno nuevo.
      // Nunca se elimina la variante/producto: solo se le crea/repara su inventario.
      log(`  -> "${v.product_title}" [${targetSku}]: sin inventory item. Se creará uno nuevo.`)
      if (!DRY_RUN && stockLocation) {
        const { result: newItems } = await createInventoryItemsWorkflow(container).run({
          input: {
            items: [
              {
                sku: targetSku,
                location_levels: [
                  {
                    location_id: stockLocation.id,
                    stocked_quantity: TARGET_STOCK_QTY,
                  },
                ],
              },
            ],
          },
        })
        const newItem = newItems[0]
        await link.create({
          [Modules.PRODUCT]: { variant_id: v.id },
          [Modules.INVENTORY]: { inventory_item_id: newItem.id },
        })
        officialInventoryItemIds.add(newItem.id)
        log(`     -> ✅ Creado y vinculado: ${newItem.id} (${TARGET_STOCK_QTY} u. en Bodega Principal).`)
      } else if (!DRY_RUN && !stockLocation) {
        // No debería ocurrir: Fase 1 crea la bodega antes de llegar aquí en modo real.
        logErr(`Inventario de variante ${targetSku}`, new Error("Bodega Principal no disponible en modo real."))
        allVariantsHealthy = false
      } else {
        log(`     -> [DRY_RUN] Se crearía inventory item + nivel de stock + vínculo a la variante.`)
      }
    } catch (e) {
      logErr(`Inventario de variante ${v.sku ?? v.id}`, e)
      allVariantsHealthy = false
    }
  }

  // Limpieza de huérfanos/fantasma — SOLO si todo lo anterior salió bien
  log("\n[FASE 4b] Limpieza de inventory items huérfanos/fantasma")
  const allVariantsCovered = officialInventoryItemIds.size >= realVariants.length
  if (!DRY_RUN && (!allVariantsHealthy || !allVariantsCovered)) {
    log(
      `  -> ⚠️  No todas las variantes quedaron con inventory item confirmado (${officialInventoryItemIds.size}/${realVariants.length}) o hay problemas pendientes arriba. NO se eliminan huérfanos en esta corrida por seguridad. Vuelve a correr el script tras resolverlo.`
    )
  } else {
    try {
      const allItems = await inventoryModuleService.listInventoryItems({})
      const junkItems = allItems.filter(
        (item: any) =>
          !officialInventoryItemIds.has(item.id) &&
          (isJunkSku(item.sku) || demotedItemIds.has(item.id))
      )
      log(`  -> ${allItems.length} inventory item(s) totales. ${junkItems.length} candidato(s) a eliminar.`)
      for (const item of junkItems) {
        log(`     - "${item.sku ?? "(sin sku)"}" (${item.id})`)
      }
      if (junkItems.length > 0) {
        if (!DRY_RUN) {
          await inventoryModuleService.deleteInventoryItems(junkItems.map((i: any) => i.id))
          log(`  -> ✅ ${junkItems.length} inventory item(s) fantasma eliminado(s).`)
        } else {
          log(`  -> [DRY_RUN] Se eliminarían ${junkItems.length} inventory item(s) fantasma (recién DESPUÉS de confirmar las 15 variantes reales en una corrida real).`)
        }
      }
    } catch (e) {
      logErr("Limpieza de huérfanos", e)
    }
  }

  // =========================================================================
  // FASE 5: Reporte final
  // =========================================================================
  log("\n" + "=".repeat(78))
  log("REPORTE FINAL")
  log("=".repeat(78))
  log(`Modo: ${DRY_RUN ? "DRY_RUN (nada se escribió)" : "APLICACIÓN REAL"}`)
  log(`Errores encontrados: ${errors.length}`)
  if (errors.length) {
    errors.forEach((e) => log(e))
  }

  if (canonicalKey) {
    log("\n" + "-".repeat(78))
    log("PUBLISHABLE KEY PARA EL FRONTEND (NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY):")
    log(canonicalKey.token ?? "(token no disponible en modo DRY_RUN si la key aún no existe)")
    log("-".repeat(78))
  }

  log("\nCOMANDOS DE EJECUCIÓN:")
  log("  Simulación:      DRY_RUN=true  npx medusa exec ./src/scripts/normalize-store.ts")
  log("  Aplicación real:  DRY_RUN=false npx medusa exec ./src/scripts/normalize-store.ts")

  log("\nVARIABLES DE ENTORNO A CONFIGURAR:")
  log("  Backend (Railway):")
  log("    - Ninguna nueva; el script usa la DATABASE_URL ya configurada del servicio.")
  log("  Frontend (Next.js / Railway o Vercel):")
  log("    - NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = <token impreso arriba>")
  log("    - NEXT_PUBLIC_MEDUSA_SALES_CHANNEL_ID = " + (salesChannel?.id ?? "(pendiente, correr script primero)"))

  log("\n" + "=".repeat(78))
  log(DRY_RUN ? "DRY_RUN completo. Revisa el reporte y corre con DRY_RUN=false cuando confirmes." : "NORMALIZACIÓN APLICADA.")
  log("=".repeat(78))
}
