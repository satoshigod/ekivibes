type OrderItem = {
  product_title?: string
  variant_title?: string
  quantity?: number
  total?: number
}

type ShippingAddress = {
  first_name?: string
  last_name?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
}

type OrderStatusData = {
  order: {
    display_id: number
    email: string
    currency_code: string
    items?: OrderItem[]
    shipping_address?: ShippingAddress
  }
  stage: "fulfilled" | "shipped" | "delivered"
  tracking?: { number?: string; url?: string }
}

const BRAND_GOLD = "#A8935E"
const SUPPORT_EMAIL = "contacto@ekivibes.com"

const STAGE_COPY: Record<OrderStatusData["stage"], { title: string; body: string }> = {
  fulfilled: {
    title: "Tu pedido está siendo preparado",
    body: "Estamos alistando tu pedido para enviarlo. Te avisaremos en cuanto salga de bodega.",
  },
  shipped: {
    title: "Tu pedido va en camino",
    body: "Tu pedido salió de bodega y está en camino a la dirección de entrega.",
  },
  delivered: {
    title: "Tu pedido fue entregado",
    body: "Confirmamos la entrega de tu pedido. ¡Gracias por comprar en Ekivibes!",
  },
}

function money(amount: number | undefined | null, currency: string) {
  const value = typeof amount === "number" && !Number.isNaN(amount) ? amount : 0
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: (currency || "COP").toUpperCase(),
  }).format(value)
}

export function orderStatusHtml({ order, stage, tracking }: OrderStatusData): string {
  const nombre = order.shipping_address?.first_name || "cliente"
  const copy = STAGE_COPY[stage]
  const items = order.items || []

  const itemsHtml = items.length
    ? `
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        ${items
          .map((item) => {
            const cantidad = typeof item.quantity === "number" ? item.quantity : 1
            const nombreItem = item.product_title || "Producto"
            const varianteItem = item.variant_title ? ` (${item.variant_title})` : ""
            return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #eee;">
            <div style="font-weight:600;color:#1a1a1a;font-size:14px;">${nombreItem}${varianteItem}</div>
            <div style="color:#888;font-size:13px;margin-top:2px;">Cantidad: ${cantidad}</div>
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;vertical-align:top;font-weight:600;color:#1a1a1a;font-size:14px;">
            ${money(item.total, order.currency_code)}
          </td>
        </tr>`
          })
          .join("")}
      </table>`
    : ""

  const direccion = order.shipping_address
  const direccionHtml = direccion
    ? `
      <div style="margin-top:20px;">
        <div style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Dirección de envío</div>
        <div style="color:#444;font-size:14px;line-height:1.5;">
          ${direccion.first_name || ""} ${direccion.last_name || ""}<br>
          ${direccion.address_1 || ""}${direccion.address_2 ? ", " + direccion.address_2 : ""}<br>
          ${direccion.city || ""}${direccion.province ? ", " + direccion.province : ""}
        </div>
      </div>`
    : ""

  const trackingHtml = tracking?.number
    ? `
      <div style="margin-top:20px;">
        <div style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Número de guía</div>
        <div style="color:#1a1a1a;font-size:15px;font-weight:600;margin-bottom:12px;">${tracking.number}</div>
        ${
          tracking.url
            ? `<a href="${tracking.url}" style="display:inline-block;background:${BRAND_GOLD};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:4px;">Rastrear pedido</a>`
            : ""
        }
      </div>`
    : ""

  return `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${copy.title}: pedido #${order.display_id}.
  </div>
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background:#1a1a1a;padding:28px 24px;text-align:center;border-top:3px solid ${BRAND_GOLD};">
      <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:2px;">EKIVIBES</span>
    </div>
    <div style="padding:32px 24px 8px 24px;">
      <h1 style="color:#1a1a1a;font-size:20px;margin:0 0 8px 0;">${copy.title}</h1>
      <p style="color:#555;font-size:14px;line-height:1.5;margin:0 0 4px 0;">
        Hola ${nombre}, ${copy.body.charAt(0).toLowerCase()}${copy.body.slice(1)}
      </p>
      <p style="color:#888;font-size:13px;margin:8px 0 0 0;">Pedido #${order.display_id}</p>
    </div>
    <div style="padding:8px 24px 24px 24px;">
      ${itemsHtml}
      ${trackingHtml}
      ${direccionHtml}
    </div>
    <div style="background:#f8f8f8;padding:24px;border-top:1px solid #eee;">
      <p style="color:#888;font-size:12px;line-height:1.6;margin:0 0 8px 0;text-align:center;">
        Este es un correo automático relacionado con tu compra. Si tienes alguna pregunta sobre tu pedido,
        escríbenos a <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_GOLD};text-decoration:none;">${SUPPORT_EMAIL}</a>.
      </p>
      <p style="color:#aaa;font-size:11px;text-align:center;margin:12px 0 0 0;">
        Ekivibes Colombia · Pedido #${order.display_id}
      </p>
    </div>
  </div>`
}
