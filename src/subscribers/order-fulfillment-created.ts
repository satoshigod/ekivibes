import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendOrderFulfilledWorkflow } from "../workflows/send-order-fulfilled"

type EventData = { order_id: string; fulfillment_id: string; no_notification?: boolean }

export default async function orderFulfillmentCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<EventData>) {
  if (data.no_notification) {
    return
  }
  await sendOrderFulfilledWorkflow(container).run({
    input: { order_id: data.order_id },
  })
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
}
