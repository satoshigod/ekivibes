/**
 * src/scripts/fix-inventory-titles.ts
 *
 * Homogeniza el titulo de los inventory items.
 *
 * Los SKU de equitacion quedaron con nombre descriptivo ("Chaleco Airbag VH-M")
 * y los de moto con el nombre de la variante ("M", "Gris Oscuro / L"), porque
 * los creo otro seed. En Admin > Inventory eso hace ilegible la lista.
 *
 * Se reescribe el titulo como "<producto> - <variante>", quitando de paso
 * espacios y tabuladores sobrantes (MLV-ADU-L trae un tab del seed original).
 *
 * Los titulos se normalizan a ASCII: sin tildes ni enes. El titulo de
 * inventory item es interno (Admin, exports CSV, integraciones de bodega y
 * transportadora) y los caracteres no ASCII se corrompen al pasar entre
 * sistemas. Los acentos se conservan donde importan: en el titulo del
 * PRODUCTO, que es lo que lee el cliente en la tienda.
 *
 * NO toca el titulo del producto ni el de la variante: solo el del inventory
 * item, que es interno de Admin y no se muestra en la tienda.
 *
 * DRY_RUN=true por defecto.
 *
 * Uso, desde /app en el contenedor de Railway:
 *   DRY_RUN=true  npx medusa exec ./src/scripts/fix-inventory-titles.ts
 *   DRY_RUN=false npx medusa exec ./src/scripts/fix-inventory-titles.ts
 */

import { ExecArgs, IInventoryService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/** Quita tildes y enes: el titulo de inventory item es interno (Admin, exports,
 *  integraciones). Los acentos se conservan solo en el titulo del PRODUCTO,
 *  que es lo que ve el cliente en la tienda. */
function ascii(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
}

function limpiar(s: string): string {
  return ascii(s).replace(/\s+/g, " ").trim()
}

export default async function fixInventoryTitles({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventory: IInventoryService = container.resolve(Modules.INVENTORY)

  const DRY_RUN = process.env.DRY_RUN !== "false"
  logger.info("")
  logger.info(
    `=== TITULOS DE INVENTORY ITEMS — ${DRY_RUN ? "DRY_RUN (simulacion)" : "APLICACION REAL"} ===`
  )

  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "title", "variants.title", "variants.product.title"],
  })

  const cambios: { id: string; title: string }[] = []

  for (const it of items as any[]) {
    const v = (it.variants || [])[0]
    if (!v?.product?.title) {
      logger.warn(`  ${it.sku}: sin producto enlazado, se omite`)
      continue
    }
    const prod = limpiar(v.product.title)
    const varia = limpiar(v.title || "")
    // "Default variant" no aporta nada al nombre
    const nuevo =
      !varia || /^default variant$/i.test(varia) ? prod : `${prod} - ${varia}`

    const actual = it.title || ""
    if (limpiar(actual) === nuevo) {
      continue
    }
    cambios.push({ id: it.id, title: nuevo })
    logger.info(`  ${String(it.sku).padEnd(16)} "${actual}"`)
    logger.info(`  ${" ".repeat(16)}  -> "${nuevo}"`)
  }

  logger.info("")
  if (!cambios.length) {
    logger.info("Nada que cambiar.")
    return
  }

  if (DRY_RUN) {
    logger.info(`[simulacion] se actualizarian ${cambios.length} titulos.`)
    logger.info(
      "Para aplicar: DRY_RUN=false npx medusa exec ./src/scripts/fix-inventory-titles.ts"
    )
    return
  }

  await inventory.updateInventoryItems(cambios)
  logger.info(`${cambios.length} titulos actualizados.`)
  logger.info("Verifica con: npx medusa exec ./src/scripts/audit-inventory-titles.ts")
}
