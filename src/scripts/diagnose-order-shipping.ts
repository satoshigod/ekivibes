/**
 * src/scripts/diagnose-order-shipping.ts
 * EJECUCIÓN: ORDER_DISPLAY_ID=51 npx medusa exec ./src/scripts/diagnose-order-shipping.ts
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function diagnoseOrderShipping({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const displayId = process.env.ORDER_DISPLAY_ID
  if (!displayId) {
    logger.info("❌ Falta ORDER_DISPLAY_ID en el entorno")
    return
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "shipping_methods.id", "shipping_methods.shipping_option_id", "shipping_methods.data"],
    filters: { display_id: Number(displayId) },
  })

  const order = orders[0] as any
  if (!order) {
    logger.info(`❌ No se encontró la orden con display_id=${displayId}`)
    return
  }

  logger.info(`Orden ${order.display_id} (${order.id})`)
  for (const m of order.shipping_methods ?? []) {
    logger.info(`  shipping_method.id: ${m.id}`)
    logger.info(`  shipping_option_id: ${m.shipping_option_id}`)
    logger.info(`  data (snapshot): ${JSON.stringify(m.data)}`)
  }

  logger.info("=".repeat(70))
  logger.info("TODAS las shipping options que existen ahora mismo:")
  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "provider_id", "data"],
  })
  for (const opt of options as any[]) {
    logger.info(`  id=${opt.id} name="${opt.name}" provider_id=${opt.provider_id} data=${JSON.stringify(opt.data)}`)
  }
}
