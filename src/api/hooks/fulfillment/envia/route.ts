import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * Webhook de Envia.com — regístralo una vez contra la Queries API sandbox:
 *
 *   POST https://queries-test.envia.com/webhooks
 *   Authorization: Bearer $ENVIA_API_TOKEN
 *   { "type_id": <ver /webhook-types>, "url": "https://<backend-railway>/hooks/fulfillment/envia", "active": 1 }
 *
 * Nota: esta ruta vive fuera de /admin y /store, así que Medusa NO le aplica
 * auth automática (igual que /hooks/payment/wompi) — no requiere tocar
 * middlewares.ts para esto.
 */
type EnviaWebhookPayload = {
  trackingNumber?: string
  carrier?: string
  status?: string
  event?: string
  [key: string]: unknown
}

export async function POST(req: MedusaRequest<EnviaWebhookPayload>, res: MedusaResponse) {
  try {
    const payload = req.body
    const trackingNumber = payload?.trackingNumber

    if (!trackingNumber) {
      console.warn("[ENVIA webhook] payload sin trackingNumber:", JSON.stringify(payload))
      return res.sendStatus(200)
    }

    const orderModuleService = req.scope.resolve(Modules.ORDER)

    const orders = await orderModuleService.listOrders(
      { fulfillments: { labels: { tracking_number: trackingNumber } } },
      { relations: ["fulfillments", "fulfillments.labels"] }
    )

    const order = orders[0]
    if (!order) {
      console.warn("[ENVIA webhook] sin orden para tracking:", trackingNumber)
      return res.sendStatus(200)
    }

    await orderModuleService.updateOrders(order.id, {
      metadata: {
        ...order.metadata,
        envia_tracking_status: payload.status ?? payload.event ?? "updated",
        envia_tracking_updated_at: new Date().toISOString(),
      },
    })

    console.log("[ENVIA webhook] orden actualizada:", order.id, "status:", payload.status)
    res.sendStatus(200)
  } catch (err: any) {
    console.error("[ENVIA webhook] error:", err?.message)
    res.sendStatus(200)
  }
}
