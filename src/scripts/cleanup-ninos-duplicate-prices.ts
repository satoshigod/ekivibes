/**
 * cleanup-ninos-duplicate-prices.ts
 *
 * Elimina (soft-delete, reversible) las 2 filas de precio con region_id rule
 * que son redundantes junto al precio COP genérico, para VH-NIN-XS y
 * MLV-NIN-2XS. IDs hardcodeados a propósito — cero riesgo de tocar otra fila.
 *
 * Corre con:
 *   npx medusa exec ./src/scripts/cleanup-ninos-duplicate-prices.ts
 *
 * Reversible con pricingModuleService.restorePrices([...]) si hace falta.
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

// Las 2 filas con price_rules.region_id — redundantes junto al precio COP
// genérico (sin reglas) que queda como única fuente de verdad.
const PRICE_IDS_TO_DELETE = [
  "price_01KZSGZP6ZKBK69ASPEBR52154", // VH-NIN-XS, region_id=COLOMBIA
  "price_01KZSGZPESPKM85XQ2SQ627PHF", // MLV-NIN-2XS, region_id=COLOMBIA
]

export default async function cleanupNinosDuplicatePrices({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const pricingModuleService = container.resolve(Modules.PRICING)

  // Verificación previa: confirmar que son exactamente las filas esperadas
  // (mismo currency, mismo monto que su par genérico) antes de borrar nada.
  const before = await pricingModuleService.listPrices(
    { id: PRICE_IDS_TO_DELETE },
    { relations: ["price_rules"] }
  )

  logger.info(`\n=== Filas a eliminar (verificación previa) ===`)
  before.forEach((p: any) => {
    logger.info(
      `  ${p.id} amount=${p.amount} currency=${p.currency_code} rules=${JSON.stringify(p.price_rules)}`
    )
  })

  if (before.length !== PRICE_IDS_TO_DELETE.length) {
    logger.error(
      `Se esperaban ${PRICE_IDS_TO_DELETE.length} filas y se encontraron ${before.length}. Abortando sin borrar nada.`
    )
    return
  }

  await pricingModuleService.softDeletePrices(PRICE_IDS_TO_DELETE)
  logger.info(`\n✓ Soft-deleted: ${PRICE_IDS_TO_DELETE.join(", ")}`)

  // Confirmación posterior: cada variante afectada debe quedar con 1 sola
  // fila de precio COP (la genérica, sin reglas).
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "prices.id", "prices.amount", "prices.currency_code"],
    filters: { sku: ["VH-NIN-XS", "MLV-NIN-2XS"] },
  })

  logger.info(`\n=== Estado final ===`)
  variants?.forEach((v: any) => {
    logger.info(`  ${v.sku}: ${JSON.stringify(v.prices)}`)
  })
}
