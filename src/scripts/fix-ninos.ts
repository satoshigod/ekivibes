import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function fixNinos({ container }: ExecArgs) {
  const productService = container.resolve("productModuleService")
  const pricingService = container.resolve("pricingModuleService")
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const inventoryService = container.resolve("inventory")
  const stockLocationService = container.resolve("stockLocationModuleService")

  console.log("=== fix-ninos: configurando productos Niños ===")

  // Buscar sales channel TIENDA EKIVIBE COLOMBIA
  const allChannels = await salesChannelService.listSalesChannels({})
  const channel = allChannels.find((c: any) =>
    c.name.toUpperCase().includes("EKIVIBE") || c.name.toUpperCase().includes("EKIVIBES")
  ) || allChannels[0]
  console.log("Sales channel:", channel.name, channel.id)

  // Buscar bodega
  const [locations] = await stockLocationService.listStockLocations({})
  const location = locations.find((l: any) => l.name.toUpperCase().includes("MEDELLIN")) || locations[0]
  console.log("Bodega:", location.name, location.id)

  // Buscar todos los productos
  const [products] = await productService.listProducts(
    {},
    { relations: ["variants", "options", "sales_channels"] }
  )

  const vhNinos = products.find((p: any) =>
    p.title.includes("VH") && p.title.toLowerCase().includes("ni")
  )
  const mlvNinos = products.find((p: any) =>
    p.title.includes("MLV") && p.title.toLowerCase().includes("ni")
  )

  console.log("VH Niños:", vhNinos?.id, vhNinos?.title)
  console.log("MLV3-H Niños:", mlvNinos?.id, mlvNinos?.title)

  if (!vhNinos || !mlvNinos) {
    console.error("No se encontraron los productos Niños!")
    return
  }

  // ---- Configurar VH Niños ----
  await configureProduct({
    product: vhNinos,
    handle: "chaleco-airbag-vh-ninos",
    description: "Chaleco airbag de equitación certificado CE para niños. Tela suave y elástica de nuevo estilo. El cartucho de CO2 de 50cc (0,85 kg) es casi invisible. Cubre cuello, pecho, espalda y coxis. Talla niños XS (altura 125-135 cm).",
    optionTitle: "Talla",
    variantTitle: "XS",
    sku: "VH-NINOS-XS",
    priceAmount: 1750000,
    channelId: channel.id,
    locationId: location.id,
    productService,
    pricingService,
    inventoryService,
  })

  // ---- Configurar MLV3-H Niños ----
  await configureProduct({
    product: mlvNinos,
    handle: "chaleco-airbag-mlv3-h-ninos",
    description: "Chaleco airbag de equitación certificado CE para niños. Cubre cuello, pecho, espalda y coxis. Diseño tipo arnés con cinturón ajustable. Cartucho de CO2 de 50cc. Talla niños 2XS (altura 125-135 cm).",
    optionTitle: "Talla",
    variantTitle: "2XS",
    sku: "MLV3H-NINOS-2XS",
    priceAmount: 1950000,
    channelId: channel.id,
    locationId: location.id,
    productService,
    pricingService,
    inventoryService,
  })

  console.log("=== fix-ninos: listo ===")
}

async function configureProduct({
  product, handle, description, optionTitle, variantTitle, sku,
  priceAmount, channelId, locationId,
  productService, pricingService, inventoryService,
}: any) {
  console.log(`\n-- Configurando ${product.title} --`)

  // 1. Actualizar handle, descripción y sales channel
  await productService.updateProducts([{
    id: product.id,
    handle,
    description,
    status: "published",
    sales_channels: [{ id: channelId }],
  }])
  console.log(`  ✓ handle=${handle}, descripción y sales channel OK`)

  // 2. Crear opción Talla si no existe
  let option = product.options?.find((o: any) => o.title === optionTitle)
  if (!option) {
    const [created] = await productService.createProductOptions([{
      title: optionTitle,
      product_id: product.id,
      values: [variantTitle],
    }])
    option = created
    console.log(`  ✓ Opción ${optionTitle} creada`)
  }

  // 3. Crear o actualizar variante
  let variant = product.variants?.[0]
  if (!variant) {
    const [created] = await productService.createProductVariants([{
      title: variantTitle,
      sku,
      product_id: product.id,
      options: [{ option_id: option.id, value: variantTitle }],
      manage_inventory: true,
    }])
    variant = created
    console.log(`  ✓ Variante ${variantTitle} creada: ${variant.id}`)
  } else {
    await productService.updateProductVariants([{
      id: variant.id,
      title: variantTitle,
      sku: sku,
      manage_inventory: true,
    }])
    console.log(`  ✓ Variante ${variantTitle} actualizada: ${variant.id}`)
  }

  // 4. Precio COP
  try {
    await pricingService.createPriceSets([{
      rules: [],
      prices: [{
        currency_code: "cop",
        amount: priceAmount,
        rules: {},
      }],
    }])
    console.log(`  ✓ Precio COP ${priceAmount} creado`)
  } catch (e: any) {
    console.log(`  ~ Precio ya existe o error: ${e.message}`)
  }

  // 5. Inventory
  try {
    const invItem = await inventoryService.createInventoryItems({
      sku,
      description: `${product.title} - ${variantTitle}`,
      requires_shipping: true,
    })
    await inventoryService.createInventoryLevels({
      inventory_item_id: (invItem as any).id,
      location_id: locationId,
      stocked_quantity: 100,
    })
    console.log(`  ✓ Inventario creado con 100 unidades`)
  } catch (e: any) {
    console.log(`  ~ Inventario: ${e.message}`)
  }
}
