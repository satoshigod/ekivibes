import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const VH_NINOS_ID = "prod_01KZPGA9173EFNVPTRM4ZFKHS2"
const MLV_NINOS_ID = "prod_01KZPGKJGYE9A7MCANTS6V0Z97"
const CHANNEL_ID = "sc_01KZPAP849X2E6DFPE4GDAG7MC"
const LOCATION_ID = "sloc_01KZPAFBNMW4WBK5VRZQA5G1C2"

export default async function fixNinos({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT) as any
  const inventoryService = container.resolve(Modules.INVENTORY) as any

  console.log("=== fix-ninos ===")

  await setupProduct(productService, inventoryService, {
    productId: VH_NINOS_ID,
    handle: "chaleco-airbag-vh-ninos",
    description: "Chaleco airbag de equitación certificado CE para niños. Tela suave y elástica de nuevo estilo. Cartucho de CO2 de 50cc (0,85 kg). Talla niños XS (altura 125-135 cm).",
    variantTitle: "XS",
    sku: "VH-NINOS-XS",
    price: 1750000,
  })

  await setupProduct(productService, inventoryService, {
    productId: MLV_NINOS_ID,
    handle: "chaleco-airbag-mlv3-h-ninos",
    description: "Chaleco airbag de equitación certificado CE para niños. Cubre cuello, pecho, espalda y coxis. Diseño tipo arnés con cinturón ajustable. Cartucho de CO2 de 50cc. Talla niños 2XS (altura 125-135 cm).",
    variantTitle: "2XS",
    sku: "MLV3H-NINOS-2XS",
    price: 1950000,
  })

  console.log("=== listo ===")
}

async function setupProduct(
  productService: any,
  inventoryService: any,
  opts: { productId: string; handle: string; description: string; variantTitle: string; sku: string; price: number }
) {
  const { productId, handle, description, variantTitle, sku, price } = opts
  console.log(`\n-- ${handle} --`)

  // 1. Actualizar handle y descripción
  await productService.updateProducts([{
    id: productId,
    handle,
    description,
    status: "published",
  }])
  console.log(`  ✓ handle y descripción`)

  // 2. Obtener producto sin relations (Medusa v2 no acepta relations en retrieve)
  const product = await productService.retrieveProduct(productId)
  console.log(`  ~ variants: ${product.variants?.length ?? 0}, options: ${product.options?.length ?? 0}`)

  // 3. Crear opción Talla
  let optionId: string
  if (product.options?.length > 0) {
    optionId = product.options[0].id
    console.log(`  ~ Opción ya existe: ${optionId}`)
  } else {
    const created = await productService.createProductOptions([{
      title: "Talla",
      product_id: productId,
      values: [variantTitle],
    }])
    optionId = Array.isArray(created) ? created[0].id : created.id
    console.log(`  ✓ Opción creada: ${optionId}`)
  }

  // 4. Crear o actualizar variante
  if (product.variants?.length > 0) {
    const vid = product.variants[0].id
    await productService.updateProductVariants([{
      id: vid,
      title: variantTitle,
      sku,
      manage_inventory: true,
    }])
    console.log(`  ✓ Variante actualizada: ${vid}`)
  } else {
    const created = await productService.createProductVariants([{
      title: variantTitle,
      sku,
      product_id: productId,
      manage_inventory: true,
    }])
    const vid = Array.isArray(created) ? created[0].id : created.id
    console.log(`  ✓ Variante creada: ${vid}`)
  }

  // 5. Inventory item + stock
  try {
    const items = await inventoryService.createInventoryItems([{
      sku,
      requires_shipping: true,
    }])
    const invId = Array.isArray(items) ? items[0].id : (items as any).id
    await inventoryService.createInventoryLevels([{
      inventory_item_id: invId,
      location_id: LOCATION_ID,
      stocked_quantity: 100,
    }])
    console.log(`  ✓ Inventario 100 unidades`)
  } catch (e: any) {
    console.log(`  ~ Inventario: ${e.message}`)
  }
}
