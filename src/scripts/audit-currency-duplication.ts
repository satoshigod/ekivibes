/**
 * audit-currency-duplication.ts
 *
 * Diagnóstico de solo lectura. Corre con:
 *   npx medusa exec ./src/scripts/audit-currency-duplication.ts
 *
 * Objetivo: confirmar si existe más de una currency "peso colombiano" en
 * store.supported_currencies (ej. "cop" + "colombia") y, si es así, listar
 * cuántos PriceSets tienen precios duplicados en ambas para el mismo variant.
 * No modifica nada.
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function auditCurrencyDuplication({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const storeModuleService = container.resolve(Modules.STORE)

  // 1. Currencies activas en el Store
  const [store] = await storeModuleService.listStores()
  logger.info(`\n=== STORE.supported_currencies ===`)
  logger.info(JSON.stringify(store.supported_currencies, null, 2))

  // 2. Regiones y su currency_code
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
  })
  logger.info(`\n=== REGIONES ===`)
  regions.forEach((r: any) =>
    logger.info(`${r.name} -> currency_code: "${r.currency_code}" (id: ${r.id})`)
  )

  // 3. Todas las currencies "sospechosas" (cualquiera que no sea cop/eur/usd)
  const currencyModuleService = container.resolve(Modules.CURRENCY)
  const currencies = await currencyModuleService.listCurrencies()
  logger.info(`\n=== TODAS LAS CURRENCIES EN LA TABLA currency ===`)
  currencies.forEach((c: any) =>
    logger.info(`code: "${c.code}" | name: "${c.name}" | symbol: "${c.symbol}"`)
  )

  const copLike = currencies.filter((c: any) =>
    /cop|colombia|peso/i.test(c.code) || /cop|colombia|peso/i.test(c.name || "")
  )
  if (copLike.length > 1) {
    logger.warn(
      `\n⚠️  DUPLICIDAD CONFIRMADA: ${copLike.length} currencies apuntan a peso colombiano: ` +
        copLike.map((c: any) => `"${c.code}"`).join(", ")
    )
  } else {
    logger.info(`\n✅ Solo una currency de peso colombiano encontrada: "${copLike[0]?.code}"`)
  }

  // 4. Muestra: precios del producto de la captura (ajusta el handle/id si lo tienes)
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "variants.id",
      "variants.title",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
    pagination: { take: 5 },
  })
  logger.info(`\n=== MUESTRA: precios crudos por variante (primeros 5 productos) ===`)
  products.forEach((p: any) => {
    p.variants?.forEach((v: any) => {
      logger.info(`${p.title} / ${v.title}: ${JSON.stringify(v.prices)}`)
    })
  })
}
