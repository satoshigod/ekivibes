/**
 * src/scripts/delete-unused-api-key.ts
 *
 * Elimina una llave publicable que ningun storefront usa.
 *
 * POR QUE ES DELICADO: si un storefront tiene esa llave en
 * NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY, borrarla deja la tienda sin catalogo
 * de inmediato. Medusa no registra que llave se esta usando, asi que el
 * script no puede averiguarlo solo: hay que mirar las variables de entorno
 * del storefront en Railway.
 *
 * Por eso exige confirmacion explicita: no basta con DRY_RUN=false, hay que
 * pasar tambien el prefijo del token a eliminar, que obliga a mirar cual es.
 *
 * Uso, desde /app en el contenedor de Railway:
 *   # 1. ver las llaves y sus tokens completos
 *   npx medusa exec ./src/scripts/delete-unused-api-key.ts
 *
 *   # 2. comparar en Railway: ekivibes-storefront > Variables >
 *   #    NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY  y  hitair-colombia-storefront
 *
 *   # 3. eliminar, indicando el prefijo de la que NO se usa
 *   DRY_RUN=false BORRAR_TOKEN=pk_3b5a6a9 npx medusa exec ./src/scripts/delete-unused-api-key.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { deleteApiKeysWorkflow } from "@medusajs/medusa/core-flows"

export default async function deleteUnusedApiKey({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const DRY_RUN = process.env.DRY_RUN !== "false"
  const PREFIJO = (process.env.BORRAR_TOKEN || "").trim()

  const { data: llaves } = await query.graph({
    entity: "api_key",
    fields: [
      "id",
      "title",
      "token",
      "type",
      "revoked_at",
      "sales_channels.id",
      "sales_channels.name",
    ],
  })

  const publicas = (llaves as any[]).filter((k) => k.type === "publishable")

  logger.info("")
  logger.info("=== LLAVES PUBLICABLES ===")
  for (const k of publicas) {
    const canales = (k.sales_channels || []).map((c: any) => c.name).join(", ")
    logger.info("")
    logger.info(`  ${k.title}`)
    logger.info(`    token   : ${k.token}`)
    logger.info(`    canales : ${canales || "NINGUNO"}`)
    logger.info(`    revocada: ${k.revoked_at ? "si" : "no"}`)
  }

  logger.info("")
  logger.info("Compara estos tokens con las variables de los storefronts:")
  logger.info("  ekivibes-storefront        > NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY")
  logger.info("  hitair-colombia-storefront > NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY")

  if (!PREFIJO) {
    logger.info("")
    logger.info(
      "Para eliminar una, pasa su prefijo: " +
        "DRY_RUN=false BORRAR_TOKEN=pk_xxxxxxx npx medusa exec ./src/scripts/delete-unused-api-key.ts"
    )
    return
  }

  const objetivo = publicas.filter((k) => String(k.token).startsWith(PREFIJO))
  if (!objetivo.length) {
    logger.error(`Ninguna llave empieza por "${PREFIJO}". Nada que hacer.`)
    return
  }
  if (objetivo.length > 1) {
    logger.error(
      `El prefijo "${PREFIJO}" coincide con ${objetivo.length} llaves. ` +
        `Usa un prefijo mas largo.`
    )
    return
  }

  const k = objetivo[0]
  logger.info("")
  logger.info(`Objetivo: ${k.title}  (${k.token})`)

  if (DRY_RUN) {
    logger.info("[simulacion] se eliminaria esta llave. Nada fue modificado.")
    logger.info("Confirma primero que NINGUN storefront la tenga configurada.")
    return
  }

  await deleteApiKeysWorkflow(container).run({ input: { ids: [k.id] } })
  logger.info(`Llave eliminada: ${k.title}`)
  logger.info("Verifica que ambas tiendas sigan cargando productos.")
}
