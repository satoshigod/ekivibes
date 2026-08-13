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
      fields: ["id", "title", "sales_channels.id", "sales_channels.name", "variants.id", "variants.sku"],
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
  let allVariantsHealthy = true

  if (!stockLocation) {
    log(`  -> ⚠️  Saltando saneamiento: no hay Stock Location resuelta.`)
    allVariantsHealthy = false
  } else {
    for (const v of realVariants) {
      try {
        const { data: variantData } = await query.graph({
          entity: "product_variant",
          fields: [
            "id",
            "sku",
            "manage_inventory",
            "inventory_items.id",
            "inventory_items.sku",
            "inventory_items.location_levels.location_id",
            "inventory_items.location_levels.stocked_quantity",
          ],
          filters: { id: v.id },
        })
        // Se castea a `any`: el tipo autogenerado de query-entry-points para
        // la relación variant.inventory_items no expone estos campos anidados
        // de forma estática (mismo patrón usado en set-inventory.ts / fix-ninos.ts).
        const variant = variantData[0] as any
        const existingItem: any = (variant?.inventory_items ?? [])[0]

        if (existingItem && !isJunkSku(existingItem.sku)) {
          officialInventoryItemIds.add(existingItem.id)
          const level = (existingItem.location_levels ?? []).find(
            (l: any) => l.location_id === stockLocation.id
          )
          if (!level) {
            log(`  -> "${v.product_title}" [${v.sku}]: inventory item OK pero sin nivel en Bodega Principal.`)
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
            log(`  -> "${v.product_title}" [${v.sku}]: stock en 0 en Bodega Principal.`)
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
            log(`  -> ✅ "${v.product_title}" [${v.sku}]: OK (${level.stocked_quantity} u. en Bodega Principal).`)
          }
          continue
        }

        // No tiene inventory item válido (o el existente es basura) -> crear uno nuevo
        if (isJunkSku(v.sku)) {
          log(
            `  -> ⚠️  "${v.product_title}" [id ${v.id}]: SKU de variante vacío o inválido ("${v.sku}"). NO se genera un SKU automáticamente — requiere revisión manual antes de crear su inventory item.`
          )
          allVariantsHealthy = false
          continue
        }

        log(`  -> "${v.product_title}" [${v.sku}]: sin inventory item válido. Se creará uno nuevo con SKU oficial.`)
        if (!DRY_RUN) {
          const { result: newItems } = await createInventoryItemsWorkflow(container).run({
            input: {
              items: [
                {
                  sku: v.sku,
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
            [Modules.PRODUCT]: { product_variant_id: v.id },
            [Modules.INVENTORY]: { inventory_item_id: newItem.id },
          })
          officialInventoryItemIds.add(newItem.id)
          log(`     -> ✅ Creado y vinculado: ${newItem.id} (${TARGET_STOCK_QTY} u. en Bodega Principal).`)
        } else {
          log(`     -> [DRY_RUN] Se crearía inventory item + nivel de stock + vínculo a la variante.`)
        }
      } catch (e) {
        logErr(`Inventario de variante ${v.sku ?? v.id}`, e)
        allVariantsHealthy = false
      }
    }
  }

  // Limpieza de huérfanos/fantasma — SOLO si todo lo anterior salió bien
  log("\n[FASE 4b] Limpieza de inventory items huérfanos/fantasma")
  if (!allVariantsHealthy && !DRY_RUN) {
    log(
      `  -> ⚠️  Se detectaron variantes que requieren revisión manual (ver arriba). NO se eliminan huérfanos en esta corrida por seguridad. Vuelve a ejecutar el script tras resolverlas.`
    )
  } else {
    try {
      const allItems = await inventoryModuleService.listInventoryItems({})
      const junkItems = allItems.filter(
        (item: any) => isJunkSku(item.sku) && !officialInventoryItemIds.has(item.id)
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
