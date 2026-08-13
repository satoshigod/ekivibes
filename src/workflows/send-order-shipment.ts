import { createWorkflow, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { sendNotificationStep } from "./steps/send-notification"

type WorkflowInput = { fulfillment_id: string }

export const sendOrderShipmentWorkflow = createWorkflow(
  "send-order-shipment",
  ({ fulfillment_id }: WorkflowInput) => {
    const { data: fulfillments } = useQueryGraphStep({
      entity: "fulfillment",
      fields: [
        "id",
        "labels.tracking_number",
        "labels.tracking_url",
        "order.id",
        "order.display_id",
        "order.email",
        "order.currency_code",
        "order.total",
        "order.items.product_title",
        "order.items.variant_title",
        "order.items.quantity",
        "order.items.total",
        "order.shipping_address.*",
      ],
      filters: { id: fulfillment_id },
      options: { throwIfKeyNotFound: true },
    })

    const notification = when({ fulfillments }, (data) => !!(data.fulfillments[0] as any)?.order?.email).then(() => {
      const fulfillment = fulfillments[0] as any
      const order = fulfillment.order
      const label = fulfillment.labels?.[0]

      return sendNotificationStep([{
        to: order.email,
        channel: "email",
        template: "order-shipped",
        data: {
          order,
          tracking: label
            ? { number: label.tracking_number, url: label.tracking_url }
            : undefined,
        },
      }])
    })

    return new WorkflowResponse({ notification })
  }
)
