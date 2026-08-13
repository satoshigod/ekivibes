import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendOrderShipmentWorkflow } from "../workflows/send-order-shipment"

type EventData = { id: string; no_notification?: boolean }

export default async function shipmentCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<EventData>) {
  if (data.no_notification) {
    return
  }
  await sendOrderShipmentWorkflow(container).run({
    input: { fulfillment_id: data.id },
  })
}

export const config: SubscriberConfig = {
  event: "shipment.created",
}
