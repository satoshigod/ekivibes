import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function fixNinos({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT) as any
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL) as any
  const inventoryService = container.resolve(Modules.INVENTORY) as any
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION) as any

  console.log("=== fix-ninos ===")

  const [allChannels] = await salesChannelService.listSalesChannels({})
  const channel = allChannels.find((c: any) =>
    c.name.toUpperCase().includes("EKIVIBE")
  ) || allChannels[0]
  console.log("Canal:", channel.name, channel.id)

  const [locations] = await stockLocationService.listStockLocations({})
  const location = locations.find((l: any) =>
    l.name.toUpperCase().includes("MEDELLIN")
  ) || locations[0]
  console.log("Bodega:", location.name, location.id)

  const [products] = await productService.listProducts(
    {},
    { relations: ["variants", "variants.options", "options", "options.values"] }
  )

  const vhNinos = products.find((p: any) =>
    p.title.includes("VH") && p.title.toLowerCase().includes("ni")
  )
  const mlvNinos = products.find((p: any) =>
    p.title.includes("MLV") && p.title.toLowerCase().includes("ni")
  )

  if (!vhNinos || !mlvNinos) {
    console.error("Productos Niños no encontrados")
    return
  }

  console.log("VH Niños:", vhNinos.id)
  console.log("MLV3-H Niños:", mlvNinos.id)

  await setupProduct(productService, inventoryService, channel, location, {
    product: vhNinos,
    handle: "chaleco-airbag-vh-ninos",
    description: "Chaleco airbag de equitación certificado CE para niños. Tela suave y elástica de nuevo estilo. Cartucho de CO2 de 50cc (0,85 kg). Talla niños XS (altura 125-135 cm).",
    variantTitle: "XS",
    sku: "VH-NINOS-XS",
    price: 1750000,
  })

  await setupProduct(productService, inventoryService, channel, location, {
    product: mlvNinos,
    handle: "chaleco-airbag-mlv3-h-ninos",
    description: "Chaleco airbag de equitación certificado CE para niños. Cubre cuello, pecho, espalda y coxis. Diseño tipo arnés con cinturón ajustable. Cartucho de CO2 de 50cc. Talla niños 2XS (altura 125-135 cm).",
    variantTitle: "2XS",
    sku: "MLV3H-NINOS-2XS",
    price: 1950000,
  })

  console.log("=== fix-ninos: listo ===")
}

async function setupProduct(
  productService: any,
  inventoryService: any,
  channel: any,
  location: any,
  opts: { product: any; handle: string; description: string; variantTitle: string; sku: string; price: number }
) {
  const { product, handle, description, variantTitle, sku, price } = opts
  console.log(`\n-- ${product.title} --`)

  // 1. Actualizar handle y descripción
  await productService.updateProducts([{
    id: product.id,
    handle,
    description,
    status: "published",
  }])
  console.log(`  ✓ handle y descripción OK`)

  // 2. Crear opción Talla si no existe
  let option = product.options?.find((o: any) => o.title === "Talla")
  if (!option) {
    const created = await productService.createProductOptions([{
      title: "Talla",
      product_id: product.id,
      values: [variantTitle],
    }])
    option = Array.isArray(created) ? created[0] : created
    console.log(`  ✓ Opción Talla creada`)
  }

  // 3. Crear o actualizar variante
  let variant = product.variants?.[0]
  if (!variant) {
    const created = await productService.createProductVariants([{
      title: variantTitle,
      sku,
      product_id: product.id,
      options: [{ option_id: option.id, value: variantTitle }],
      manage_inventory: true,
      prices: [{ amount: price, currency_code: "cop" }],
    }])
    variant = Array.isArray(created) ? created[0] : created
    console.log(`  ✓ Variante ${variantTitle} creada: ${variant.id}`)
  } else {
    await productService.updateProductVariants([{
      id: variant.id,
      title: variantTitle,
      sku,
      manage_inventory: true,
      prices: [{ amount: price, currency_code: "cop" }],
    }])
    console.log(`  ✓ Variante ${variantTitle} actualizada`)
  }

  // 4. Inventory item + stock
  try {
    const invItem = await inventoryService.createInventoryItems([{
      sku,
      description: `${product.title} - ${variantTitle}`,
      requires_shipping: true,
    }])
    const invId = Array.isArray(invItem) ? invItem[0].id : (invItem as any).id
    await inventoryService.createInventoryLevels([{
      inventory_item_id: invId,
      location_id: location.id,
      stocked_quantity: 100,
    }])
    console.log(`  ✓ Inventario 100 unidades OK`)
  } catch (e: any) {
    console.log(`  ~ Inventario: ${e.message}`)
  }
}
