/**
 * src/scripts/consolidate-stock-locations.ts
 *
 * CONSOLIDA LAS DOS STOCK LOCATIONS EN "Bodega Principal"
 * =======================================================
 *
 * Situacion que corrige:
 *  - Existen dos ubicaciones. "Bodega Principal" tiene la opcion de envio
 *    configurada; "BODEGA MEDELLIN" tiene su zona vacia.
 *  - Los canales de Hit-Air cuelgan SOLO de BODEGA MEDELLIN, que no despacha:
 *    el checkout de moto no ofrece metodo de envio y no se puede pagar.
 *  - El canal de Ekivibes cuelga de AMBAS, asi que Medusa suma disponibilidad
 *    y muestra el doble de stock (el "stock fantasma").
 *
 * Se conserva "Bodega Principal" porque ya tiene envios funcionando: recrear
 * opciones de envio con sus reglas de precio es mucho mas fragil que crear
 * niveles de inventario y enlazar canales.
 *
 * Pasos:
 *   1. Libera las reservas de los pedidos de prueba.
 *   2. Mueve TODOS los canales de venta de MEDELLIN a Bodega Principal.
 *   3. Crea en Bodega Principal los niveles que falten (los SKU de moto).
 *   4. Deja todos los niveles de Bodega Principal en la cantidad indicada.
 *   5. Borra todos los niveles de BODEGA MEDELLIN.
 *   6. Desconecta BODEGA MEDELLIN de todo canal de venta.
 *
 * La ubicacion vacia NO se elimina: queda inerte y sin canales. Borrarla
 * arrastraria su fulfillment set y no aporta nada hacerlo ahora.
 *
 * Uso, desde /app en el contenedor de Railway:
 *   npx medusa exec ./src/scripts/consolidate-stock-locations.ts          (simulacion)
 *   npx medusa exec ./src/scripts/consolidate-stock-locations.ts -- --apply
 */

import { ExecArgs, IInventoryService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"

const CONSERVAR = "sloc_01KZXNX7PWYTJZE1KVASB4B76M" // Bodega Principal
const RETIRAR = "sloc_01KZPAFBNMW4WBK5VRZQA5G1C2" // BODEGA MEDELLIN
const CANTIDAD_OBJETIVO = 10

export default async function consolidate({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventory: IInventoryService = container.resolve(Modules.INVENTORY)

  const APPLY = (args || []).includes("--apply")
  const modo = APPLY ? "APLICANDO CAMBIOS" : "SIMULACION (usa -- --apply para ejecutar)"
  logger.info("")
  logger.info(`=== CONSOLIDACION DE UBICACIONES — ${modo} ===`)

  const { data: locs } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name", "sales_channels.id", "sales_channels.name"],
  })
  const conservar: any = locs.find((l: any) => l.id === CONSERVAR)
  const retirar: any = locs.find((l: any) => l.id === RETIRAR)

  if (!conservar || !retirar) {
    logger.error("No se encontraron las dos ubicaciones esperadas. Abortado.")
    return
  }
  logger.info(`  Se conserva : ${conservar.name}  [${conservar.id}]`)
  logger.info(`  Se retira   : ${retirar.name}  [${retirar.id}]`)

  // ---------------------------------------------------------------- 1
  const { data: reservas } = await query.graph({
    entity: "reservation_item",
    fields: ["id", "quantity", "location_id"],
  })
  logger.info("")
  logger.info(`PASO 1 — liberar ${reservas.length} reservas de pedidos de prueba`)
  if (reservas.length) {
    if (APPLY) {
      await inventory.deleteReservationItems(reservas.map((r: any) => r.id))
      logger.info(`  ${reservas.length} reservas eliminadas`)
    } else {
      logger.info(`  [simulacion] se eliminarian ${reservas.length} reservas`)
    }
  }

  // ---------------------------------------------------------------- 2
  const canalesRetirar = (retirar.sales_channels || []).map((c: any) => c.id)
  const canalesConservar = new Set(
    (conservar.sales_channels || []).map((c: any) => c.id)
  )
  const aAgregar = canalesRetirar.filter((id: string) => !canalesConservar.has(id))

  logger.info("")
  logger.info(`PASO 2 — mover canales de venta a ${conservar.name}`)
  for (const c of retirar.sales_channels || []) {
    const ya = canalesConservar.has(c.id) ? " (ya estaba)" : ""
    logger.info(`  ${c.name}${ya}`)
  }
  if (aAgregar.length && APPLY) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: CONSERVAR, add: aAgregar },
    })
    logger.info(`  ${aAgregar.length} canales enlazados`)
  } else if (!APPLY) {
    logger.info(`  [simulacion] se enlazarian ${aAgregar.length} canales`)
  }

  // ---------------------------------------------------------------- 3 y 4
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: [
      "id",
      "sku",
      "location_levels.id",
      "location_levels.location_id",
      "location_levels.stocked_quantity",
    ],
  })

  const crear: any[] = []
  const ajustar: { id: string; sku: string; de: number }[] = []
  const borrar: { id: string; sku: string }[] = []

  for (const it of items as any[]) {
    const niveles = it.location_levels || []
    const enConservar = niveles.find((n: any) => n.location_id === CONSERVAR)
    const enRetirar = niveles.find((n: any) => n.location_id === RETIRAR)

    if (!enConservar) {
      crear.push({
        inventory_item_id: it.id,
        location_id: CONSERVAR,
        stocked_quantity: CANTIDAD_OBJETIVO,
      })
    } else if (Number(enConservar.stocked_quantity) !== CANTIDAD_OBJETIVO) {
      ajustar.push({
        id: enConservar.id,
        sku: it.sku,
        de: Number(enConservar.stocked_quantity),
      })
    }
    if (enRetirar) {
      borrar.push({ id: enRetirar.id, sku: it.sku })
    }
  }

  logger.info("")
  logger.info(`PASO 3 — crear ${crear.length} niveles faltantes en ${conservar.name}`)
  for (const c of crear) {
    const sku = (items as any[]).find((i) => i.id === c.inventory_item_id)?.sku
    logger.info(`  ${sku} -> ${CANTIDAD_OBJETIVO} uds`)
  }
  if (crear.length && APPLY) {
    await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: crear },
    })
    logger.info(`  ${crear.length} niveles creados`)
  }

  logger.info("")
  logger.info(`PASO 4 — igualar ${ajustar.length} niveles a ${CANTIDAD_OBJETIVO} uds`)
  for (const a of ajustar) {
    logger.info(`  ${a.sku}: ${a.de} -> ${CANTIDAD_OBJETIVO}`)
  }
  if (ajustar.length && APPLY) {
    for (const a of ajustar) {
      await inventory.updateInventoryLevels([
        { id: a.id, stocked_quantity: CANTIDAD_OBJETIVO } as any,
      ])
    }
    logger.info(`  ${ajustar.length} niveles ajustados`)
  }

  // ---------------------------------------------------------------- 5
  logger.info("")
  logger.info(`PASO 5 — borrar ${borrar.length} niveles de ${retirar.name}`)
  for (const b of borrar) {
    logger.info(`  ${b.sku}`)
  }
  if (borrar.length && APPLY) {
    for (const b of borrar) {
      await inventory.updateInventoryLevels([
        { id: b.id, stocked_quantity: 0 } as any,
      ])
    }
    await inventory.deleteInventoryLevels(borrar.map((b) => b.id))
    logger.info(`  ${borrar.length} niveles eliminados`)
  }

  // ---------------------------------------------------------------- 6
  logger.info("")
  logger.info(`PASO 6 — desconectar ${retirar.name} de todos los canales`)
  if (canalesRetirar.length && APPLY) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: RETIRAR, remove: canalesRetirar },
    })
    logger.info(`  ${canalesRetirar.length} canales desconectados`)
  } else if (!APPLY) {
    logger.info(`  [simulacion] se desconectarian ${canalesRetirar.length} canales`)
  }

  logger.info("")
  if (APPLY) {
    logger.info("=== LISTO ===")
    logger.info("Verifica con: npx medusa exec ./src/scripts/audit-stock-locations.ts")
    logger.info(
      `En NocoDB, el almacen Bodega Principal debe tener medusa_location_id = ${CONSERVAR}`
    )
  } else {
    logger.info("Simulacion terminada. Nada fue modificado.")
    logger.info(
      "Para ejecutar: npx medusa exec ./src/scripts/consolidate-stock-locations.ts -- --apply"
    )
  }
}
