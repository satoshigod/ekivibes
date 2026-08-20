import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { mirrorOrderToNocodbWorkflow } from "../workflows/mirror-order-to-nocodb"

const NOCODB_URL = process.env.NOCODB_URL || ""
const NOCODB_TOKEN = process.env.NOCODB_TOKEN || ""
const T_FALLOS = process.env.NOCODB_TABLE_FALLOS_ESPEJADO || ""

/**
 * Registra el fallo en NocoDB para que quede una lista reprocesable.
 * Este registro es best-effort: si NocoDB tambien esta caido, no hay a
 * donde escribir el fallo, y el logger.error es lo unico que queda.
 */
async function registrarFallo(orderId: string, mensaje: string, logger: any) {
  if (!NOCODB_URL || !NOCODB_TOKEN || !T_FALLOS) return
  try {
    await fetch(`${NOCODB_URL}/api/v2/tables/${T_FALLOS}/records`, {
      method: "POST",
      headers: { "xc-token": NOCODB_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({
        medusa_order_id: orderId,
        fecha: new Date().toISOString(),
        error: mensaje,
        reintentos: 0,
        resuelto: false,
      }),
    })
  } catch (e: any) {
    logger.error(`[nocodb] no se pudo registrar el fallo de espejado en NocoDB: ${e?.message}`)
  }
}

/**
 * Espeja el pedido en NocoDB para el estado de resultados.
 *
 * Va aparte del subscriber que envia el correo de confirmacion: si el
 * espejo falla, el cliente debe recibir su correo igual, y al reves. No se
 * relanza el error por la misma razon: un problema de NocoDB no puede
 * tumbar el flujo de un pedido ya pagado.
 *
 * Si falla, ademas del log se deja un registro en la tabla fallos_espejado
 * de NocoDB: los logs de Railway rotan y un pedido sin espejar es un
 * hueco invisible en el estado de resultados si solo queda en el log.
 */
export default async function orderPlacedNocodbHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  try {
    await mirrorOrderToNocodbWorkflow(container).run({ input: { id: data.id } })
  } catch (err: any) {
    logger.error(`[nocodb] no se pudo espejar el pedido ${data.id}: ${err?.message}`)
    await registrarFallo(data.id, err?.message || "error desconocido", logger)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "order-placed-nocodb" },
}
