import { createWorkflow, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { sendNotificationStep } from "./steps/send-notification"

type WorkflowInput = { order_id: string }

export const sendOrderFulfilledWorkflow = createWorkflow(
  "send-order-fulfilled",
  ({ order_id }: WorkflowInput) => {
    const { data: orders } = useQueryGraphStep({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "total",
        "shipping_address.*",
      ],
      filters: { id: order_id },
      options: { throwIfKeyNotFound: true },
    })

    const notification = when({ orders }, (data) => !!data.orders[0].email).then(() => {
      return sendNotificationStep([{
        to: orders[0].email!,
        channel: "email",
        template: "order-fulfilled",
        data: { order: orders[0] },
      }])
    })

    return new WorkflowResponse({ notification })
  }
)
