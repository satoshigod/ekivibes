import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { mirrorOrderToNocodbStep } from "./steps/mirror-order-to-nocodb"

type WorkflowInput = { id: string }

/**
 * Espeja un pedido de Medusa en NocoDB para poder calcular utilidad.
 * Se dispara desde el subscriber de order.placed.
 */
export const mirrorOrderToNocodbWorkflow = createWorkflow(
  "mirror-order-to-nocodb",
  ({ id }: WorkflowInput) => {
    const { data: orders } = useQueryGraphStep({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "created_at",
        "currency_code",
        "total",
        "subtotal",
        "item_total",
        "shipping_total",
        "discount_total",
        "customer_id",
        "customer.*",
        // el wildcard es necesario para que resuelvan los campos calculados
        "items.*",
        "items.variant_sku",
        "shipping_address.*",
        "sales_channel.id",
        "sales_channel.name",
      ],
      filters: { id },
      options: { throwIfKeyNotFound: true },
    })

    const resultado = mirrorOrderToNocodbStep({ order: orders[0] })

    return new WorkflowResponse({ resultado })
  }
)
