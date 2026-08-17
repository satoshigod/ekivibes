/**
 * src/scripts/audit-shipping-price-rules.ts
 * EJECUCIÓN: npx medusa exec ./src/scripts/audit-shipping-price-rules.ts
 * Solo lectura. Compara las price rules (envío gratis condicional) de las
 * dos shipping options en conflicto: "Envio Nacional" vs "Envío estándar".
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function auditShippingPriceRules({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "name",
      "provider_id",
      "service_zone.id",
      "service_zone.name",
      "service_zone.geo_zones.country_code",
      "service_zone.geo_zones.type",
      "prices.id",
      "prices.amount",
      "prices.currency_code",
      "prices.price_rules.attribute",
      "prices.price_rules.operator",
      "prices.price_rules.value",
    ],
  })

  logger.info("=".repeat(70))
  for (const optRaw of options) {
    const opt = optRaw as any
    logger.info(
      `"${opt.name}" (id=${opt.id})\n` +
        `  provider_id: ${opt.provider_id}\n` +
        `  service_zone: ${opt.service_zone?.name} (${opt.service_zone?.id})\n` +
        `  geo_zones: ${JSON.stringify(opt.service_zone?.geo_zones)}\n` +
        `  prices: ${JSON.stringify(opt.prices, null, 2)}`
    )
    logger.info("-".repeat(70))
  }
}
