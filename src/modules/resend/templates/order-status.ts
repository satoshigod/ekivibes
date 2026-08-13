type TrackingInfo = {
  number?: string
  url?: string
}

type OrderStatusData = {
  order: {
    display_id: number
    email: string
    currency_code: string
    total: number
    shipping_address?: {
      first_name?: string
      city?: string
      province?: string
    }
  }
  stage: "fulfilled" | "shipped" | "delivered"
  tracking?: TrackingInfo
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

export function orderStatusHtml({ order, stage, tracking }: OrderStatusData): string {
  const nombre = order.shipping_address?.first_name || "cliente"
  const copy = STAGE_COPY[stage]

  const trackingHtml = tracking?.number
    ? `
      <tr>
        <td style="padding:20px 0 0 0;">
          <div style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Número de guía</div>
          <div style="color:#1a1a1a;font-size:15px;font-weight:600;">
            ${tracking.url ? `<a href="${tracking.url}" style="color:${BRAND_GOLD};text-decoration:none;">${tracking.number}</a>` : tracking.number}
          </div>
        </td>
      </tr>`
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
      <table style="width:100%;">
        ${trackingHtml}
      </table>
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
