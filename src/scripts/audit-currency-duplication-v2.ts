/**
 * audit-currency-duplication-v2.ts
 *
 * Corrige el bug de la v1 (store.supported_currencies venía vacío porque
 * listStores() no expande esa columna por defecto) y agrega el deep-dive
 * real que hace falta: por qué "Chaleco Airbag VH Niños / XS" y
 * "Chaleco Airbag MLV3-H Niños / 2XS" tienen 2 filas de precio cada una
 * con el mismo currency_code + amount.
 *
 * Solo lectura. Corre con:
 *   npx medusa exec ./src/scripts/audit-currency-duplication-v2.ts
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const SUSPECT_SKUS = ["VH-NINOS-XS", "MLV3H-NINOS-2XS", "VH-NIN-XS", "MLV-NIN-2XS"]

export default async function auditCurrencyDuplicationV2({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // 1. supported_currencies del store, vía query.graph (no via módulo directo)
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "name", "supported_currencies.currency_code", "supported_currencies.is_default"],
  })
  logger.info(`\n=== STORE.supported_currencies (fix v2) ===`)
  logger.info(JSON.stringify(stores, null, 2))

  // 2. Deep-dive en los SKUs sospechosos: traer CADA fila de precio con
  //    price_list_id, price_rules y timestamps.
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: [
      "id",
      "sku",
      "title",
      "product.title",
      "prices.id",
      "prices.amount",
      "prices.currency_code",
      "prices.price_list_id",
      "prices.min_quantity",
      "prices.max_quantity",
      "prices.created_at",
      "prices.updated_at",
      "prices.price_rules.attribute",
      "prices.price_rules.value",
    ],
    filters: { sku: SUSPECT_SKUS },
  })

  logger.info(`\n=== DEEP-DIVE: variantes sospechosas (${variants?.length ?? 0} encontradas) ===`)
  variants?.forEach((v: any) => {
    logger.info(`\n--- ${v.product?.title} / ${v.title} (sku: ${v.sku}, variant_id: ${v.id}) ---`)
    v.prices?.forEach((p: any) => {
      logger.info(
        `  price_id=${p.id} amount=${p.amount} currency=${p.currency_code} ` +
          `price_list_id=${p.price_list_id ?? "null"} min_qty=${p.min_quantity ?? "null"} ` +
          `rules=${JSON.stringify(p.price_rules ?? [])} created_at=${p.created_at}`
      )
    })
  })

  // 3. Barrido general: cualquier OTRA variante en la tienda con >1 precio
  //    para el mismo currency_code (para saber si el problema es solo de
  //    estos 2 SKUs o más amplio).
  const { data: allVariants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "title", "product.title", "prices.currency_code", "prices.amount"],
    pagination: { take: 200 },
  })

  logger.info(`\n=== BARRIDO GENERAL: variantes con >1 precio en el mismo currency_code ===`)
  let found = 0
  allVariants?.forEach((v: any) => {
    const byCurrency: Record<string, number> = {}
    v.prices?.forEach((p: any) => {
      byCurrency[p.currency_code] = (byCurrency[p.currency_code] || 0) + 1
    })
    const dupCurrencies = Object.entries(byCurrency).filter(([, count]) => count > 1)
    if (dupCurrencies.length > 0) {
      found++
      logger.warn(
        `  ${v.product?.title} / ${v.title} (sku: ${v.sku}) -> ` +
          dupCurrencies.map(([c, n]) => `${c}: ${n} filas`).join(", ")
      )
    }
  })
  if (found === 0) {
    logger.info(`  Ninguna otra variante tiene precios duplicados por currency.`)
  } else {
    logger.warn(`  Total variantes afectadas: ${found}`)
  }
}
