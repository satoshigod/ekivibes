import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function setInventory({ container }: ExecArgs) {
  const inventoryService = container.resolve(Modules.INVENTORY) as any
  const productService = container.resolve(Modules.PRODUCT) as any
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION) as any

  console.log("Fetching stock locations...")
  const locations = await stockLocationService.listStockLocations({})
  console.log("Locations:", locations.map((l: any) => `${l.name} (${l.id})`))

  if (!locations.length) {
    console.log("No stock locations found!")
    return
  }

  const location = locations[0]
  console.log("Using location:", location.name, location.id)

  console.log("Fetching products...")
  const products = await productService.listProducts({}, { relations: ["variants"] })
  console.log("Products found:", products.length)

  for (const product of products) {
    for (const variant of (product as any).variants || []) {
      try {
        // Get inventory items for variant
        const inventoryItems = await inventoryService.listInventoryItems({
          sku: variant.sku,
        })

        if (!inventoryItems.length) {
          console.log(`  No inventory item for variant ${variant.id} - creating...`)
          const invItem = await inventoryService.createInventoryItems([{
            sku: variant.sku || variant.id,
            description: product.title,
          }])
          await inventoryService.createInventoryLevels([{
            inventory_item_id: Array.isArray(invItem) ? invItem[0].id : (invItem as any).id,
            location_id: location.id,
            stocked_quantity: 100,
          }])
          console.log(`  ✓ Created inventory for ${product.title} - ${variant.id}`)
        } else {
          const item = inventoryItems[0]
          const levels = await inventoryService.listInventoryLevels({
            inventory_item_id: item.id,
            location_id: location.id,
          })

          if (!levels.length) {
            await inventoryService.createInventoryLevels([{
              inventory_item_id: item.id,
              location_id: location.id,
              stocked_quantity: 100,
            }])
            console.log(`  ✓ Added stock level for ${product.title} - ${variant.id}`)
          } else {
            await inventoryService.updateInventoryLevels(
              { inventory_item_id: item.id, location_id: location.id },
              { stocked_quantity: 100 }
            )
            console.log(`  ✓ Updated stock for ${product.title} - ${variant.id}: 100 units`)
          }
        }
      } catch (e: any) {
        console.error(`  ✗ Error for ${variant.id}:`, e.message)
      }
    }
  }

  console.log("Done!")
}
