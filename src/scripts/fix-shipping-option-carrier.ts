/**
 * src/scripts/fix-shipping-option-carrier.ts
 * EJECUCIÓN: npx medusa exec ./src/scripts/fix-shipping-option-carrier.ts
 *
 * Cambia el "data" (fulfillment option / carrier) de la shipping option
 * "Envío estándar" de servientrega -> interrapidisimo, sin tocar precio,
 * price rules, ni nada más. Servientrega no devuelve tarifas en esta cuenta
 * sandbox; InterRapidísimo sí (confirmado con test-envia.ts).
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const SHIPPING_OPTION_ID = "so_01M00EAK49Y401P99BX4TK83ZV"
const NEW_CARRIER = "interrapidisimo"

export default async function fixShippingOptionCarrier({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT)

  const before = await fulfillmentModuleService.retrieveShippingOption(SHIPPING_OPTION_ID)
  logger.info(`Antes: data=${JSON.stringify((before as any).data)}`)

  const updated = await fulfillmentModuleService.updateShippingOptions(SHIPPING_OPTION_ID, {
    data: { id: NEW_CARRIER },
  })

  logger.info(`Después: data=${JSON.stringify((updated as any).data)}`)
  logger.info(`✅ Shipping option "${(updated as any).name}" ahora usa carrier="${NEW_CARRIER}"`)
}
