type OrderPlacedData = {
  order: {
    display_id: number
    email: string
    currency_code: string
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
    shipping_address?: { first_name?: string }
  }
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount)
}

export function orderPlacedHtml({ order }: OrderPlacedData): string {
  const nombre = order.shipping_address?.first_name || "cliente"
  const itemsHtml = order.items
    .map(
      (item) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">
        ${item.product_title}${item.variant_title ? ` (${item.variant_title})` : ""}
        <br><span style="color:#888;font-size:13px;">Cantidad: ${item.quantity}</span>
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">
        ${money(item.total, order.currency_code)}
      </td>
    </tr>`
    )
    .join("")

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:#1a1a1a;color:#fff;padding:20px;text-align:center;">
      <h1 style="margin:0;font-size:20px;">EKIVIBES</h1>
    </div>
    <div style="padding:24px;">
      <h2 style="color:#1a1a1a;">¡Gracias por tu pedido, ${nombre}!</h2>
      <p style="color:#555;">Tu pedido <strong>#${order.display_id}</strong> fue confirmado y lo estamos procesando.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        ${itemsHtml}
      </table>
      <table style="width:100%;margin-top:16px;color:#555;">
        <tr><td>Subtotal</td><td style="text-align:right;">${money(order.item_total, order.currency_code)}</td></tr>
        <tr><td>Envío</td><td style="text-align:right;">${money(order.shipping_total, order.currency_code)}</td></tr>
        <tr><td>Impuestos</td><td style="text-align:right;">${money(order.tax_total, order.currency_code)}</td></tr>
        <tr style="font-weight:bold;color:#1a1a1a;border-top:1px solid #ddd;">
          <td style="padding-top:8px;">Total</td>
          <td style="padding-top:8px;text-align:right;">${money(order.total, order.currency_code)}</td>
        </tr>
      </table>
      <p style="color:#888;font-size:13px;margin-top:24px;text-align:center;">
        Pedido: ${order.display_id} · Ekivibes Colombia
      </p>
    </div>
  </div>`
}
