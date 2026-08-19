import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { mirrorOrderToNocodbWorkflow } from "../workflows/mirror-order-to-nocodb"

/**
 * Espeja el pedido en NocoDB para el estado de resultados.
 *
 * Va aparte del subscriber que envia el correo de confirmacion: si el
 * espejo falla, el cliente debe recibir su correo igual, y al reves. No se
 * relanza el error por la misma razon: un problema de NocoDB no puede
 * tumbar el flujo de un pedido ya pagado.
 */
export default async function orderPlacedNocodbHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    await mirrorOrderToNocodbWorkflow(container).run({ input: { id: data.id } })
  } catch (err: any) {
    container
      .resolve("logger")
      .error(`[nocodb] no se pudo espejar el pedido ${data.id}: ${err?.message}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "order-placed-nocodb" },
}
