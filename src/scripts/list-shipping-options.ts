/**
 * src/scripts/list-shipping-options.ts
 * EJECUCIÓN: npx medusa exec ./src/scripts/list-shipping-options.ts
 * (trigger redeploy)
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function listShippingOptions({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "name",
      "price_type",
      "provider_id",
      "service_zone.name",
      "prices.amount",
      "prices.currency_code",
    ],
  })

  logger.info("=".repeat(70))
  for (const opt of options) {
    logger.info(
      `"${opt.name}" (id=${opt.id})\n` +
        `  provider_id: ${opt.provider_id}\n` +
        `  price_type: ${opt.price_type}\n` +
        `  service_zone: ${(opt as any).service_zone?.name}\n` +
        `  prices: ${JSON.stringify(opt.prices)}`
    )
    logger.info("-".repeat(70))
  }
}
