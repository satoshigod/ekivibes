import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendOrderDeliveryWorkflow } from "../workflows/send-order-delivery"

type EventData = { id: string }

export default async function deliveryCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<EventData>) {
  await sendOrderDeliveryWorkflow(container).run({
    input: { fulfillment_id: data.id },
  })
}

export const config: SubscriberConfig = {
  event: "delivery.created",
}
