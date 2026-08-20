/**
 * src/scripts/reprocesar-fallos-espejado.ts
 *
 * Lista los pedidos que fallaron al espejarse hacia NocoDB (tabla
 * fallos_espejado, escrita por src/subscribers/order-placed-nocodb.ts) y,
 * si se pide explicitamente, los reintenta.
 *
 * Por que hace falta: order-placed-nocodb.ts nunca relanza el error del
 * espejado (una venta pagada no puede caerse por un problema de NocoDB),
 * asi que un fallo no vuelve a intentarse solo. Sin este script, el unico
 * rastro es un log de Railway que rota.
 *
 * SEGURIDAD:
 *  - Sin REPROCESAR=true: solo lista los fallos pendientes (resuelto=false),
 *    no escribe nada. Este es el modo por defecto.
 *  - Con REPROCESAR=true: corre mirrorOrderToNocodbWorkflow para
 *    cada fallo pendiente. El workflow ya es idempotente (indice unico en
 *    medusa_order_id + captura de colision), asi que reprocesar un pedido
 *    que en realidad SI se alcanzo a espejar no lo duplica.
 *  - Cada pedido reprocesado se marca resuelto=true si el workflow corre
 *    sin lanzar error, y se le suma 1 a reintentos si vuelve a fallar.
 *
 * USO, desde /app en el contenedor de Railway:
 *   npx medusa exec ./src/scripts/reprocesar-fallos-espejado.ts
 *   REPROCESAR=true npx medusa exec ./src/scripts/reprocesar-fallos-espejado.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { mirrorOrderToNocodbWorkflow } from "../workflows/mirror-order-to-nocodb"

const NOCODB_URL = process.env.NOCODB_URL || ""
const NOCODB_TOKEN = process.env.NOCODB_TOKEN || ""
const T_FALLOS = process.env.NOCODB_TABLE_FALLOS_ESPEJADO || ""

async function nocodb(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${NOCODB_URL}${path}`, {
    method: init?.method || "GET",
    headers: { "xc-token": NOCODB_TOKEN, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    throw new Error(`NocoDB ${res.status} en ${path}: ${await res.text()}`)
  }
  return res.json()
}

export default async function reprocesarFallosEspejado({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const reprocesar = process.env.REPROCESAR === "true"

  if (!NOCODB_URL || !NOCODB_TOKEN || !T_FALLOS) {
    logger.error("NOCODB_URL, NOCODB_TOKEN o NOCODB_TABLE_FALLOS_ESPEJADO no configurados")
    return
  }

  const where = encodeURIComponent("(resuelto,eq,false)")
  const res = await nocodb(
    `/api/v2/tables/${T_FALLOS}/records?where=${where}&limit=200&sort=-fecha`
  )
  const pendientes: any[] = res.list || []

  logger.info(`[reprocesar-fallos] ${pendientes.length} fallo(s) pendiente(s)`)
  if (pendientes.length === 0) return

  for (const f of pendientes) {
    logger.info(
      `  - #${f.Id} pedido ${f.medusa_order_id} (${f.reintentos} reintentos previos): ${f.error}`
    )
  }

  if (!reprocesar) {
    logger.info("[reprocesar-fallos] modo solo-lectura. Correr con REPROCESAR=true para reintentar.")
    return
  }

  let ok = 0
  let siguenFallando = 0
  for (const f of pendientes) {
    try {
      await mirrorOrderToNocodbWorkflow(container).run({
        input: { id: f.medusa_order_id },
      })
      await nocodb(`/api/v2/tables/${T_FALLOS}/records`, {
        method: "PATCH",
        body: [{ Id: f.Id, resuelto: true }],
      })
      logger.info(`[reprocesar-fallos] pedido ${f.medusa_order_id} resuelto`)
      ok++
    } catch (err: any) {
      await nocodb(`/api/v2/tables/${T_FALLOS}/records`, {
        method: "PATCH",
        body: [
          {
            Id: f.Id,
            reintentos: (f.reintentos || 0) + 1,
            error: err?.message || "error desconocido",
          },
        ],
      })
      logger.error(`[reprocesar-fallos] pedido ${f.medusa_order_id} sigue fallando: ${err?.message}`)
      siguenFallando++
    }
  }

  logger.info(`[reprocesar-fallos] resultado: ${ok} resueltos, ${siguenFallando} siguen fallando`)
}
