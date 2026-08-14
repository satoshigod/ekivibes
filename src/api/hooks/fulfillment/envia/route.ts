import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

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
 *
 * FilterableOrderProps (order module) NO tiene un filtro `fulfillments` —
 * por eso NO se puede hacer orderModuleService.listOrders({ fulfillments: {...} }).
 * En su lugar se consulta la entidad `fulfillment` vía el Query Graph Module
 * y se viaja hacia `order` como relación forward (mismo patrón ya usado en
 * otras partes del backend para fulfillment -> order).
 */
type EnviaWebhookPayload = {
  trackingNumber?: string
  carrier?: string
  status?: string
  event?: string
  [key: string]: unknown
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  // Envia.com usa GET para el botón "Probar" al registrar el webhook.
  res.sendStatus(200)
}

export async function POST(req: MedusaRequest<EnviaWebhookPayload>, res: MedusaResponse) {
  try {
    const payload = req.body
    const trackingNumber = payload?.trackingNumber

    if (!trackingNumber) {
      console.warn("[ENVIA webhook] payload sin trackingNumber:", JSON.stringify(payload))
      return res.sendStatus(200)
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data: fulfillments } = await query.graph({
      entity: "fulfillment",
      fields: ["id", "order.id", "order.metadata", "labels.tracking_number"],
      filters: {
        labels: { tracking_number: trackingNumber },
      },
    })

    const order = fulfillments[0]?.order
    if (!order?.id) {
      console.warn("[ENVIA webhook] sin orden para tracking:", trackingNumber)
      return res.sendStatus(200)
    }

    const orderModuleService = req.scope.resolve(Modules.ORDER)
    await orderModuleService.updateOrders(order.id, {
      metadata: {
        ...(order.metadata ?? {}),
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

