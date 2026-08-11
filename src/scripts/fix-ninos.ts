import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ProductStatus } from "@medusajs/framework/utils"
import {
  createProductsWorkflow,
  createInventoryLevelsWorkflow,
  deleteProductsWorkflow,
} from "@medusajs/medusa/core-flows"

const VH_NINOS_ID = "prod_01KZPGA9173EFNVPTRM4ZFKHS2"
const MLV_NINOS_ID = "prod_01KZPGKJGYE9A7MCANTS6V0Z97"
const CHANNEL_ID = "sc_01KZPAP849X2E6DFPE4GDAG7MC"
const LOCATION_ID = "sloc_01KZPAFBNMW4WBK5VRZQA5G1C2"

export default async function fixNinos({ container }: ExecArgs) {
  const query = container.resolve("query")

  console.log("=== fix-ninos ===")

  // Verificar si ya tienen variantes con precios - si sí, no hacer nada
  const { data: existingVH } = await query.graph({
    entity: "product",
    fields: ["id", "variants.*", "variants.prices.*"],
    filters: { id: VH_NINOS_ID },
  })

  if ((existingVH?.[0] as any)?.variants?.length > 0) {
    console.log("VH Niños ya tiene variantes - skipping")
  } else {
    await fixProduct(container, query, {
      productId: VH_NINOS_ID,
      handle: "chaleco-airbag-vh-ninos",
      title: "Chaleco Airbag VH Niños",
      description: "Chaleco airbag de equitación certificado CE para niños. Tela suave y elástica de nuevo estilo. Cartucho de CO2 de 50cc (0,85 kg). Talla niños XS (altura 125-135 cm).",
      variantTitle: "XS",
      sku: "VH-NINOS-XS",
      price: 1750000,
    })
  }

  const { data: existingMLV } = await query.graph({
    entity: "product",
    fields: ["id", "variants.*", "variants.prices.*"],
    filters: { id: MLV_NINOS_ID },
  })

  if ((existingMLV?.[0] as any)?.variants?.length > 0) {
    console.log("MLV3-H Niños ya tiene variantes - skipping")
  } else {
    await fixProduct(container, query, {
      productId: MLV_NINOS_ID,
      handle: "chaleco-airbag-mlv3-h-ninos",
      title: "Chaleco Airbag MLV3-H Niños",
      description: "Chaleco airbag de equitación certificado CE para niños. Cubre cuello, pecho, espalda y coxis. Diseño tipo arnés con cinturón ajustable. Cartucho de CO2 de 50cc. Talla niños 2XS (altura 125-135 cm).",
      variantTitle: "2XS",
      sku: "MLV3H-NINOS-2XS",
      price: 1950000,
    })
  }

  console.log("=== listo ===")
}

async function fixProduct(container: any, query: any, opts: {
  productId: string; handle: string; title: string; description: string
  variantTitle: string; sku: string; price: number
}) {
  const { productId, handle, title, description, variantTitle, sku, price } = opts
  console.log(`\n-- ${title} --`)

  // Obtener imágenes existentes del producto antes de eliminarlo
  const { data: existing } = await query.graph({
    entity: "product",
    fields: ["id", "images.*", "category_ids"],
    filters: { id: productId },
  })
  const images = existing?.[0]?.images?.map((i: any) => ({ url: i.url })) ?? []
  const categoryIds = existing?.[0]?.category_ids ?? []
  console.log(`  imágenes: ${images.length}, categorías: ${categoryIds.length}`)

  // Eliminar producto viejo
  await deleteProductsWorkflow(container).run({
    input: { ids: [productId] },
  })
  console.log(`  ✓ Producto anterior eliminado`)

  // Crear producto nuevo completo con variante, precio e inventario
  const { result } = await createProductsWorkflow(container).run({
    input: {
      products: [{
        title,
        handle,
        description,
        status: ProductStatus.PUBLISHED,
        images,
        category_ids: categoryIds,
        sales_channels: [{ id: CHANNEL_ID }],
        options: [{ title: "Talla", values: [variantTitle] }],
        variants: [{
          title: variantTitle,
          sku,
          manage_inventory: true,
          options: { Talla: variantTitle },
          prices: [{ amount: price, currency_code: "cop" }],
        }],
      }],
    },
  })

  const newProduct = result[0]
  console.log(`  ✓ Producto creado: ${newProduct.id}`)

  // Asignar stock en bodega
  const { data: invItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
    filters: { sku },
  })

  if (invItems?.length > 0) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: [{
          inventory_item_id: invItems[0].id,
          location_id: LOCATION_ID,
          stocked_quantity: 100,
        }],
      },
    })
    console.log(`  ✓ Stock 100 unidades en bodega`)
  } else {
    console.log(`  ~ No se encontró inventory item para SKU ${sku}`)
  }
}
