import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type EnviaFulfillmentProviderService from "../../../../modules/envia-fulfillment/service"

/**
 * POST /admin/envia/pickup
 *
 * Body:
 * {
 *   "order_ids": ["order_123", "order_456"],   // deben compartir carrier
 *   "pickupDate": "2026-08-18",                 // YYYY-MM-DD
 *   "pickupTimeStart": "14:00",
 *   "pickupTimeEnd": "17:00"
 * }
 *
 * Junta los tracking numbers de las guías Envia.com ya generadas para esas
 * órdenes (deben ser del mismo carrier — Envia lo exige) y agenda UNA
 * recogida para todas. Se dispara manualmente desde el Admin, no automático.
 */
type PickupRequestBody = {
  order_ids?: string[]
  pickupDate?: string
  pickupTimeStart?: string
  pickupTimeEnd?: string
}

export async function POST(req: MedusaRequest<PickupRequestBody>, res: MedusaResponse) {
  const { order_ids, pickupDate, pickupTimeStart, pickupTimeEnd } = req.body

  if (!order_ids?.length || !pickupDate || !pickupTimeStart || !pickupTimeEnd) {
    return res.status(400).json({
      error: "Faltan campos: order_ids[], pickupDate, pickupTimeStart, pickupTimeEnd",
    })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: fulfillments } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "data", "order.id", "labels.tracking_number"],
    filters: { order: { id: order_ids } },
  })

  if (!fulfillments.length) {
    return res.status(404).json({ error: "No hay guías Envia.com generadas para esas órdenes" })
  }

  const carriers = new Set(
    fulfillments.map((f: any) => (f.data as Record<string, unknown> | undefined)?.envia_carrier)
  )
  if (carriers.size > 1) {
    return res.status(400).json({
      error: `Las órdenes tienen guías de carriers distintos (${[...carriers].join(
        ", "
      )}) — Envia.com exige una recogida por carrier. Agrúpalas por separado.`,
    })
  }
  const carrier = [...carriers][0] as string | undefined
  if (!carrier) {
    return res.status(400).json({ error: "No se encontró el carrier en la data de la guía" })
  }

  const trackingNumbers = fulfillments.flatMap((f: any) =>
    (f.labels ?? []).map((l: any) => l.tracking_number).filter(Boolean)
  )
  if (!trackingNumbers.length) {
    return res.status(400).json({ error: "Las guías no tienen tracking_number guardado" })
  }

  const enviaProvider = req.scope.resolve<EnviaFulfillmentProviderService>(
    "fp_envia-fulfillment_envia"
  )

  try {
    const pickup = await enviaProvider.requestPickup({
      carrier: carrier as any,
      trackingNumbers,
      pickupDate,
      pickupTimeStart,
      pickupTimeEnd,
    })
    res.status(200).json({ pickup })
  } catch (err: any) {
    console.error("[ENVIA pickup] error:", err?.message)
    res.status(502).json({ error: err?.message ?? "Error solicitando recogida a Envia.com" })
  }
}
