/**
 * src/scripts/fix-shipping-option-duplication.ts
 *
 * PROBLEMA: había 2 shipping options activas para Colombia, en 2 service
 * zones distintas que cubren el mismo país (co) — por eso el checkout
 * mostraba ambas a la vez ("Envio Nacional" y "Envío estándar").
 *
 *  - "Envio Nacional" (so_01KZPDT8A6W7ETYMJZNF5PVDY6): provider "manual_manual".
 *    Tenía la regla correcta de envío gratis (item_total >= 250000 -> $0),
 *    pero al usar el provider manual, un pedido con esta opción NUNCA
 *    genera automáticamente la guía real en Envía.com.
 *
 *  - "Envío estándar" (so_01M00EAK49Y401P99BX4TK83ZV): provider
 *    "envia-fulfillment_envia" — es la que de verdad dispara la generación
 *    de la guía Envía (el endpoint /admin/envia/pickup depende de que el
 *    fulfillment traiga labels.tracking_number, lo cual solo pasa si el
 *    fulfillment se creó con este provider). Pero le faltaba la regla de
 *    envío gratis: siempre cobraba $18.000 sin importar el total del carrito.
 *
 * FIX:
 *  1. Se agrega a "Envío estándar" la misma regla de precio condicional
 *     (item_total >= 250000 -> $0), conservando el precio base de $18.000.
 *  2. Se elimina (soft-delete) "Envio Nacional" — Medusa no borra
 *     históricos de órdenes ya creadas con esa opción, solo dejar de
 *     ofrecerla en checkouts nuevos.
 *
 * DRY_RUN=true por defecto (solo audita, no toca nada).
 *
 * EJECUCIÓN:
 *   DRY_RUN=true  npx medusa exec ./src/scripts/fix-shipping-option-duplication.ts
 *   DRY_RUN=false npx medusa exec ./src/scripts/fix-shipping-option-duplication.ts
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateShippingOptionsWorkflow, deleteShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"

const ENVIA_OPTION_ID = "so_01M00EAK49Y401P99BX4TK83ZV" // "Envío estándar" — provider real Envía
const MANUAL_OPTION_ID = "so_01KZPDT8A6W7ETYMJZNF5PVDY6" // "Envio Nacional" — provider manual, a eliminar
const FREE_SHIPPING_THRESHOLD = 250000

export default async function fixShippingOptionDuplication({ container }: ExecArgs) {
  const DRY_RUN = process.env.DRY_RUN !== "false"

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const log = (msg: string) => logger.info(msg)

  log("=".repeat(78))
  log(`FIX SHIPPING OPTION DUPLICATION — MODO: ${DRY_RUN ? "DRY_RUN (solo audita)" : "⚠️  APLICACIÓN REAL"}`)
  log("=".repeat(78))

  // ---------------------------------------------------------------------
  // Verificación previa: confirmar que los IDs siguen siendo los esperados
  // antes de tocar nada (por si algo cambió entre el audit y este run).
  // ---------------------------------------------------------------------
  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "name",
      "provider_id",
      "prices.id",
      "prices.amount",
      "prices.currency_code",
      "prices.price_rules.attribute",
    ],
    filters: { id: [ENVIA_OPTION_ID, MANUAL_OPTION_ID] },
  })

  const enviaOption = (options as any[]).find((o) => o.id === ENVIA_OPTION_ID)
  const manualOption = (options as any[]).find((o) => o.id === MANUAL_OPTION_ID)

  if (!enviaOption || !manualOption) {
    log(
      `  -> ❌ No se encontraron ambas opciones esperadas (envia=${!!enviaOption}, manual=${!!manualOption}). Abortando sin tocar nada — revisar manualmente.`
    )
    return
  }

  log(`  -> ✅ "${enviaOption.name}" (${enviaOption.id}) provider=${enviaOption.provider_id}`)
  log(`  -> ✅ "${manualOption.name}" (${manualOption.id}) provider=${manualOption.provider_id}`)

  const alreadyHasRule = (enviaOption.prices ?? []).some((p: any) =>
    (p.price_rules ?? []).some((r: any) => r.attribute === "item_total")
  )

  // ---------------------------------------------------------------------
  // FASE 1: agregar la regla de envío gratis a "Envío estándar"
  // ---------------------------------------------------------------------
  log("\n[FASE 1] Regla de envío gratis en la opción conectada a Envía")

  if (alreadyHasRule) {
    log(`  -> ✅ "${enviaOption.name}" ya tiene una regla sobre item_total. No se toca (evita duplicar reglas).`)
  } else {
    const basePrice = (enviaOption.prices ?? []).find((p: any) => p.currency_code === "cop")
    log(
      `  -> Se agregará precio condicional: item_total >= ${FREE_SHIPPING_THRESHOLD} -> $0 COP, ` +
        `conservando el precio base existente (${basePrice?.id}, $${basePrice?.amount}).`
    )
    if (!DRY_RUN) {
      await updateShippingOptionsWorkflow(container).run({
        input: [
          {
            id: ENVIA_OPTION_ID,
            prices: [
              // Conserva el precio base existente (mismo id -> se actualiza, no se duplica)
              ...(basePrice ? [{ id: basePrice.id, currency_code: "cop", amount: basePrice.amount }] : []),
              // Precio nuevo condicional (sin id -> se crea)
              {
                currency_code: "cop",
                amount: 0,
                rules: [{ attribute: "item_total", operator: "gte", value: FREE_SHIPPING_THRESHOLD }],
              },
            ],
          },
        ],
      })
      log(`  -> ✅ Regla aplicada a "${enviaOption.name}".`)
    } else {
      log(`  -> [DRY_RUN] Se aplicaría la regla anterior.`)
    }
  }

  // ---------------------------------------------------------------------
  // FASE 2: eliminar la opción duplicada (manual)
  // ---------------------------------------------------------------------
  log("\n[FASE 2] Eliminar opción duplicada (provider manual)")
  log(`  -> Se eliminará "${manualOption.name}" (${manualOption.id}). Soft-delete: no afecta órdenes ya creadas.`)
  if (!DRY_RUN) {
    await deleteShippingOptionsWorkflow(container).run({
      input: { ids: [MANUAL_OPTION_ID] },
    })
    log(`  -> ✅ Eliminada.`)
  } else {
    log(`  -> [DRY_RUN] Se eliminaría.`)
  }

  log("\n" + "=".repeat(78))
  log(DRY_RUN ? "DRY_RUN completo. Revisa el reporte y corre con DRY_RUN=false para aplicar." : "FIX APLICADO.")
  log("=".repeat(78))
}
