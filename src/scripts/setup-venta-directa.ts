/**
 * src/scripts/setup-venta-directa.ts
 *
 * Reconvierte el "Default Sales Channel" en un canal util para ventas que NO
 * pasan por la web: mostrador, telefono, WhatsApp y mayoristas.
 *
 * Por que este canal y no uno nuevo:
 *   - Medusa no deja borrarlo (es el default_sales_channel_id de la tienda),
 *     asi que igual va a existir. Mejor que sirva.
 *   - No tiene llave publicable, y no se le crea ninguna: ningun storefront
 *     puede consumirlo. Queda accesible solo desde Admin, que es justo lo que
 *     se quiere para venta interna.
 *   - Ya esta enlazado a Bodega Principal, la misma bodega. No hay stock
 *     separado ni riesgo de doble conteo: es el mismo inventario.
 *
 * Que hace:
 *   1. Renombra el canal.
 *   2. Enlaza TODOS los productos (equitacion y moto): en mostrador se vende
 *      cualquier cosa, la separacion por marca aplica a las tiendas web.
 *
 * Que NO hace: no crea llaves publicables, no toca los canales de Ekivibes ni
 * de Hit-Air, no cambia precios ni inventario.
 *
 * DRY_RUN=true por defecto.
 *
 * Uso, desde /app en el contenedor de Railway:
 *   DRY_RUN=true  npx medusa exec ./src/scripts/setup-venta-directa.ts
 *   DRY_RUN=false npx medusa exec ./src/scripts/setup-venta-directa.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  updateSalesChannelsWorkflow,
  linkProductsToSalesChannelWorkflow,
} from "@medusajs/medusa/core-flows"

const NOMBRE_ACTUAL = "Default Sales Channel"
const NOMBRE_NUEVO = "Venta Directa (Mostrador y Mayorista)"
const DESCRIPCION =
  "Ventas que no pasan por la web: mostrador, telefono, WhatsApp y mayoristas. " +
  "Sin llave publicable: solo se usa desde Admin, con draft orders."

export default async function setupVentaDirecta({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const DRY_RUN = process.env.DRY_RUN !== "false"
  logger.info("")
  logger.info(
    `=== CANAL DE VENTA DIRECTA — ${DRY_RUN ? "DRY_RUN (simulacion)" : "APLICACION REAL"} ===`
  )

  const { data: canales } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })
  const canal: any =
    (canales as any[]).find((c) => c.name === NOMBRE_ACTUAL) ||
    (canales as any[]).find((c) => c.name === NOMBRE_NUEVO)

  if (!canal) {
    logger.error(`No se encontro el canal "${NOMBRE_ACTUAL}". Abortado.`)
    return
  }

  // Seguridad: si alguna llave publicable lo usa, un storefront lo expondria.
  const { data: llaves } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "sales_channels.id"],
  })
  const conLlave = (llaves as any[]).filter((k) =>
    (k.sales_channels || []).some((sc: any) => sc.id === canal.id)
  )
  if (conLlave.length) {
    logger.error(
      `El canal tiene llave publicable (${conLlave
        .map((k) => k.title)
        .join(", ")}). No se configura como canal interno.`
    )
    return
  }

  const { data: productos } = await query.graph({
    entity: "product",
    fields: ["id", "title", "sales_channels.id"],
  })
  const faltantes = (productos as any[]).filter(
    (p) => !(p.sales_channels || []).some((sc: any) => sc.id === canal.id)
  )

  logger.info(`  Canal      : ${canal.name}  [${canal.id}]`)
  logger.info(`  Nuevo nombre: ${NOMBRE_NUEVO}`)
  logger.info(`  Productos a enlazar: ${faltantes.length} de ${productos.length}`)
  for (const p of faltantes) {
    logger.info(`     - ${p.title}`)
  }

  if (DRY_RUN) {
    logger.info("")
    logger.info("[simulacion] nada fue modificado.")
    logger.info(
      "Para aplicar: DRY_RUN=false npx medusa exec ./src/scripts/setup-venta-directa.ts"
    )
    return
  }

  if (canal.name !== NOMBRE_NUEVO) {
    await updateSalesChannelsWorkflow(container).run({
      input: {
        selector: { id: canal.id },
        update: { name: NOMBRE_NUEVO, description: DESCRIPCION },
      },
    })
    logger.info("  Canal renombrado.")
  }

  if (faltantes.length) {
    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: canal.id, add: faltantes.map((p) => p.id) },
    })
    logger.info(`  ${faltantes.length} productos enlazados.`)
  }

  logger.info("")
  logger.info("Listo. En Admin > Orders > Create draft order ya se puede elegir")
  logger.info("este canal para registrar una venta de mostrador o mayorista.")
  logger.info("Verifica con: npx medusa exec ./src/scripts/audit-sales-channels.ts")
}
