import { createWorkflow, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { sendNotificationStep } from "./steps/send-notification"

type WorkflowInput = { fulfillment_id: string }

export const sendOrderDeliveryWorkflow = createWorkflow(
  "send-order-delivery",
  ({ fulfillment_id }: WorkflowInput) => {
    const { data: fulfillments } = useQueryGraphStep({
      entity: "fulfillment",
      fields: [
        "id",
        "order.id",
        "order.display_id",
        "order.email",
        "order.currency_code",
        "order.total",
        "order.shipping_address.*",
      ],
      filters: { id: fulfillment_id },
      options: { throwIfKeyNotFound: true },
    })

    const notification = when({ fulfillments }, (data) => !!(data.fulfillments[0] as any)?.order?.email).then(() => {
      const fulfillment = fulfillments[0] as any
      return sendNotificationStep([{
        to: fulfillment.order.email,
        channel: "email",
        template: "order-delivered",
        data: { order: fulfillment.order },
      }])
    })

    return new WorkflowResponse({ notification })
  }
)
