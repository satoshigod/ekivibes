type OrderPlacedData = {
  order: {
    display_id: number
    email: string
    currency_code: string
    created_at?: string
    total: number
    item_total: number
    shipping_total: number
    tax_total: number
    items: Array<{
      product_title: string
      variant_title?: string
      quantity: number
      total: number
    }>
    shipping_address?: {
      first_name?: string
      last_name?: string
      address_1?: string
      address_2?: string
      city?: string
      province?: string
      country_code?: string
    }
  }
}

const BRAND_GOLD = "#A8935E"
const SUPPORT_EMAIL = "contacto@ekivibes.com"

function money(amount: number | undefined | null, currency: string) {
  const value = typeof amount === "number" && !Number.isNaN(amount) ? amount : 0
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: (currency || "COP").toUpperCase(),
  }).format(value)
}

function formatDate(iso?: string) {
  if (!iso) return ""
  try {
    return new Intl.DateTimeFormat("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso))
  } catch {
    return ""
  }
}

export function orderPlacedHtml({ order }: OrderPlacedData): string {
  const nombre = order.shipping_address?.first_name || "cliente"
  const fecha = formatDate(order.created_at)
  const items = order.items || []

  const itemsHtml = items
    .map((item) => {
      const cantidad = typeof item.quantity === "number" ? item.quantity : 1
      const nombreItem = item.product_title || "Producto"
      const varianteItem = item.variant_title ? ` (${item.variant_title})` : ""
      return `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #eee;">
        <div style="font-weight:600;color:#1a1a1a;">${nombreItem}${varianteItem}</div>
        <div style="color:#888;font-size:13px;margin-top:2px;">Cantidad: ${cantidad}</div>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #eee;text-align:right;vertical-align:top;font-weight:600;color:#1a1a1a;">
        ${money(item.total, order.currency_code)}
      </td>
    </tr>`
    })
    .join("")

  const direccion = order.shipping_address
  const direccionHtml = direccion
    ? `
      <tr>
        <td style="padding:20px 0 0 0;">
          <div style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Dirección de envío</div>
          <div style="color:#444;font-size:14px;line-height:1.5;">
            ${direccion.first_name || ""} ${direccion.last_name || ""}<br>
            ${direccion.address_1 || ""}${direccion.address_2 ? ", " + direccion.address_2 : ""}<br>
            ${direccion.city || ""}${direccion.province ? ", " + direccion.province : ""}
          </div>
        </td>
      </tr>`
    : ""

  return `
  <!-- Preheader oculto: mejora el preview en la bandeja de entrada -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Confirmamos tu pedido #${order.display_id} por ${money(order.total, order.currency_code)}.
  </div>
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background:#1a1a1a;padding:28px 24px;text-align:center;border-top:3px solid ${BRAND_GOLD};">
      <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:2px;">EKIVIBES</span>
    </div>
    <div style="padding:32px 24px 8px 24px;">
      <h1 style="color:#1a1a1a;font-size:20px;margin:0 0 8px 0;">¡Gracias por tu pedido, ${nombre}!</h1>
      <p style="color:#555;font-size:14px;line-height:1.5;margin:0;">
        Tu pedido <strong>#${order.display_id}</strong>${fecha ? ` del ${fecha}` : ""} fue confirmado y lo estamos procesando.
      </p>
    </div>
    <div style="padding:8px 24px 24px 24px;">
      <table style="width:100%;border-collapse:collapse;">
        ${itemsHtml}
      </table>
      <table style="width:100%;margin-top:16px;color:#555;font-size:14px;">
        <tr>
          <td style="padding:4px 0;">Subtotal</td>
          <td style="padding:4px 0;text-align:right;">${money(order.item_total, order.currency_code)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;">Envío</td>
          <td style="padding:4px 0;text-align:right;">${money(order.shipping_total, order.currency_code)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;">Impuestos</td>
          <td style="padding:4px 0;text-align:right;">${money(order.tax_total, order.currency_code)}</td>
        </tr>
        <tr style="font-weight:bold;color:#1a1a1a;font-size:16px;">
          <td style="padding-top:10px;border-top:1px solid #ddd;">Total</td>
          <td style="padding-top:10px;border-top:1px solid #ddd;text-align:right;">${money(order.total, order.currency_code)}</td>
        </tr>
      </table>
      <table style="width:100%;">
        ${direccionHtml}
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
