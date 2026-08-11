import { ExecArgs } from "@medusajs/framework/types"

const BASE = "http://localhost:9000"
const VH_NINOS_ID = "prod_01KZPGA9173EFNVPTRM4ZFKHS2"
const MLV_NINOS_ID = "prod_01KZPGKJGYE9A7MCANTS6V0Z97"
const CHANNEL_ID = "sc_01KZPAP849X2E6DFPE4GDAG7MC"
const LOCATION_ID = "sloc_01KZPAFBNMW4WBK5VRZQA5G1C2"

async function adminFetch(token: string, path: string, method = "GET", body?: any) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

export default async function fixNinos({ container }: ExecArgs) {
  console.log("=== fix-ninos ===")

  // Login
  const authRes = await fetch(`${BASE}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.MEDUSA_ADMIN_EMAIL || "ivan@ekivibes.com",
      password: process.env.MEDUSA_ADMIN_PASSWORD,
    }),
  })
  const authData = await authRes.json() as any
  const token = authData.token
  if (!token) {
    console.error("Login fallido:", JSON.stringify(authData))
    return
  }
  console.log("✓ Login OK")

  await setupProduct(token, {
    productId: VH_NINOS_ID,
    handle: "chaleco-airbag-vh-ninos",
    description: "Chaleco airbag de equitación certificado CE para niños. Tela suave y elástica de nuevo estilo. Cartucho de CO2 de 50cc (0,85 kg). Talla niños XS (altura 125-135 cm).",
    variantTitle: "XS",
    sku: "VH-NINOS-XS",
    price: 1750000,
  })

  await setupProduct(token, {
    productId: MLV_NINOS_ID,
    handle: "chaleco-airbag-mlv3-h-ninos",
    description: "Chaleco airbag de equitación certificado CE para niños. Cubre cuello, pecho, espalda y coxis. Diseño tipo arnés con cinturón ajustable. Cartucho de CO2 de 50cc. Talla niños 2XS (altura 125-135 cm).",
    variantTitle: "2XS",
    sku: "MLV3H-NINOS-2XS",
    price: 1950000,
  })

  console.log("=== listo ===")
}

async function setupProduct(token: string, opts: {
  productId: string; handle: string; description: string
  variantTitle: string; sku: string; price: number
}) {
  const { productId, handle, description, variantTitle, sku, price } = opts
  console.log(`\n-- ${handle} --`)

  // 1. Obtener producto actual
  const prod = await adminFetch(token, `/admin/products/${productId}`)
  const product = prod.product
  console.log(`  variants: ${product.variants?.length}, options: ${product.options?.length}`)

  // 2. Actualizar handle, descripción, sales channel
  await adminFetch(token, `/admin/products/${productId}`, "POST", {
    handle,
    description,
    status: "published",
    sales_channels: [{ id: CHANNEL_ID }],
  })
  console.log(`  ✓ handle, descripción, sales channel`)

  // 3. Opción Talla
  let optionId: string
  if (product.options?.length > 0) {
    optionId = product.options[0].id
    console.log(`  ~ Opción ya existe: ${optionId}`)
  } else {
    const r = await adminFetch(token, `/admin/products/${productId}/options`, "POST", {
      title: "Talla",
      values: [variantTitle],
    })
    optionId = r.product_option?.id || r.id
    console.log(`  ✓ Opción creada: ${optionId}`)
  }

  // 4. Variante
  let variantId: string
  if (product.variants?.length > 0) {
    variantId = product.variants[0].id
    await adminFetch(token, `/admin/products/${productId}/variants/${variantId}`, "POST", {
      title: variantTitle,
      sku,
      manage_inventory: true,
      prices: [{ amount: price, currency_code: "cop" }],
    })
    console.log(`  ✓ Variante actualizada: ${variantId}`)
  } else {
    const r = await adminFetch(token, `/admin/products/${productId}/variants`, "POST", {
      title: variantTitle,
      sku,
      manage_inventory: true,
      options: { [optionId]: variantTitle },
      prices: [{ amount: price, currency_code: "cop" }],
    })
    variantId = r.variant?.id || r.id
    console.log(`  ✓ Variante creada: ${variantId}`)
  }

  // 5. Inventory item
  const invRes = await adminFetch(token, `/admin/inventory-items`, "POST", {
    sku,
    requires_shipping: true,
  })
  const invId = invRes.inventory_item?.id
  if (invId) {
    await adminFetch(token, `/admin/inventory-items/${invId}/location-levels`, "POST", {
      location_id: LOCATION_ID,
      stocked_quantity: 100,
    })
    console.log(`  ✓ Inventario 100 unidades: ${invId}`)
  } else {
    console.log(`  ~ Inventario: ${JSON.stringify(invRes).slice(0, 100)}`)
  }
}
