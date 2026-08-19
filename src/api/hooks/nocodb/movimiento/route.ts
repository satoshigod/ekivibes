/**
 * src/api/hooks/nocodb/movimiento/route.ts
 *
 * PUENTE NOCODB -> MEDUSA (Medusa v2.18.0)
 * =========================================
 *
 * NocoDB dispara este webhook cada vez que se crea un movimiento de inventario.
 * Medusa vuelve a consultar el registro en NocoDB (el webhook solo manda el Id)
 * y aplica el delta al inventory_level de la ubicacion correspondiente.
 *
 * POR QUE SE RECONSULTA EN VEZ DE CONFIAR EN EL PAYLOAD:
 *  - Los campos de enlace de NocoDB solo traen el valor de despliegue, no el
 *    medusa_location_id ni la bandera de sincronizacion.
 *  - Reconsultar evita depender de plantillas handlebars fragiles.
 *
 * IDEMPOTENCIA:
 *  - Solo actua si el movimiento tiene empujado_a_medusa = false.
 *  - Al terminar lo marca en true. Si NocoDB reintenta o el hook dispara de
 *    nuevo por un update, el segundo intento no aplica nada.
 *  - Marcar el campo dispara otro webhook de update, que sale por el mismo
 *    guardia. No hay bucle.
 *
 * SEGURIDAD:
 *  - Header x-nocodb-secret comparado en tiempo constante contra
 *    NOCODB_WEBHOOK_SECRET.
 *  - Sin secreto configurado el endpoint rechaza todo (falla cerrado).
 *
 * VARIABLES DE ENTORNO:
 *   NOCODB_URL                 https://nocodb-production-f1f6.up.railway.app
 *   NOCODB_TOKEN               token de API de NocoDB
 *   NOCODB_WEBHOOK_SECRET      secreto compartido con el webhook
 *   NOCODB_TABLE_MOVIMIENTOS   id de la tabla movimientos_inventario
 *   NOCODB_TABLE_ALMACENES     id de la tabla almacenes
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { IInventoryService } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import crypto from "crypto"

const NOCODB_URL = process.env.NOCODB_URL || ""
const NOCODB_TOKEN = process.env.NOCODB_TOKEN || ""
const WEBHOOK_SECRET = process.env.NOCODB_WEBHOOK_SECRET || ""
const T_MOVIMIENTOS = process.env.NOCODB_TABLE_MOVIMIENTOS || ""
const T_ALMACENES = process.env.NOCODB_TABLE_ALMACENES || ""

const LOG = "[nocodb->medusa]"

function secretoValido(recibido: unknown): boolean {
  if (!WEBHOOK_SECRET || typeof recibido !== "string") {
    return false
  }
  const a = Buffer.from(recibido)
  const b = Buffer.from(WEBHOOK_SECRET)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

async function nocodb(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<any> {
  const res = await fetch(`${NOCODB_URL}${path}`, {
    method: init?.method || "GET",
    headers: {
      "xc-token": NOCODB_TOKEN,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    throw new Error(`NocoDB ${res.status} en ${path}: ${await res.text()}`)
  }
  return res.json()
}

/** Acepta tanto el body propio {movimiento_id} como el payload nativo de NocoDB. */
function extraerId(body: any): number | null {
  const crudo =
    body?.movimiento_id ??
    body?.data?.rows?.[0]?.Id ??
    body?.data?.Id ??
    body?.Id
  const n = Number(crudo)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!secretoValido(req.headers["x-nocodb-secret"])) {
    console.warn(`${LOG} secreto invalido o ausente`)
    res.status(401).json({ error: "no autorizado" })
    return
  }

  if (!NOCODB_URL || !NOCODB_TOKEN || !T_MOVIMIENTOS || !T_ALMACENES) {
    console.error(`${LOG} faltan variables de entorno de NocoDB`)
    res.status(500).json({ error: "configuracion incompleta" })
    return
  }

  const movimientoId = extraerId(req.body)
  if (!movimientoId) {
    res.status(400).json({ error: "movimiento_id ausente" })
    return
  }

  try {
    const mov = await nocodb(
      `/api/v2/tables/${T_MOVIMIENTOS}/records/${movimientoId}`
    )

    // Guardia de idempotencia: si ya se empujo, no se repite.
    if (mov.empujado_a_medusa === true || mov.empujado_a_medusa === 1) {
      console.log(`${LOG} mov ${movimientoId} ya sincronizado, se omite`)
      res.status(200).json({ ok: true, aplicado: false, razon: "ya sincronizado" })
      return
    }

    const cantidad = Number(mov.cantidad)
    if (!Number.isFinite(cantidad) || cantidad === 0) {
      res.status(200).json({ ok: true, aplicado: false, razon: "cantidad nula" })
      return
    }

    const sku: string | undefined = mov?.producto?.sku
    if (!sku) {
      console.warn(`${LOG} mov ${movimientoId} sin producto enlazado`)
      res.status(200).json({ ok: true, aplicado: false, razon: "sin producto" })
      return
    }

    const almacenId = mov.almacenes_id
    if (!almacenId) {
      res.status(200).json({ ok: true, aplicado: false, razon: "sin almacen" })
      return
    }

    const almacen = await nocodb(
      `/api/v2/tables/${T_ALMACENES}/records/${almacenId}`
    )

    // Bodegas de alquiler, demo o consignacion NO tocan Medusa.
    const sincroniza =
      almacen.sincroniza_medusa === true || almacen.sincroniza_medusa === 1
    if (!sincroniza) {
      console.log(
        `${LOG} mov ${movimientoId}: almacen "${almacen.nombre_almacen}" no sincroniza`
      )
      await nocodb(`/api/v2/tables/${T_MOVIMIENTOS}/records`, {
        method: "PATCH",
        body: [{ Id: movimientoId, empujado_a_medusa: true }],
      })
      res.status(200).json({ ok: true, aplicado: false, razon: "almacen local" })
      return
    }

    const locationId: string | undefined = almacen.medusa_location_id
    if (!locationId) {
      console.error(
        `${LOG} almacen "${almacen.nombre_almacen}" sincroniza pero no tiene medusa_location_id`
      )
      res.status(200).json({ ok: false, error: "almacen sin medusa_location_id" })
      return
    }

    // Resolver el InventoryItem desde el lado correcto: el join-table de
    // variantes devuelve pvitem_*, no el iitem_* real.
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: items } = await query.graph({
      entity: "inventory_item",
      fields: ["id", "sku", "variants.sku"],
      filters: { variants: { sku } } as any,
    })

    if (!items?.length) {
      console.error(`${LOG} no existe InventoryItem para SKU ${sku}`)
      res.status(200).json({ ok: false, error: `SKU ${sku} sin inventario en Medusa` })
      return
    }
    if (items.length > 1) {
      console.error(`${LOG} SKU ${sku} tiene ${items.length} InventoryItems`)
      res.status(200).json({ ok: false, error: `SKU ${sku} duplicado en Medusa` })
      return
    }

    const inventoryService: IInventoryService = req.scope.resolve(Modules.INVENTORY)
    const nivel = await inventoryService.adjustInventory(
      items[0].id,
      locationId,
      cantidad
    )

    await nocodb(`/api/v2/tables/${T_MOVIMIENTOS}/records`, {
      method: "PATCH",
      body: [{ Id: movimientoId, empujado_a_medusa: true }],
    })

    console.log(
      `${LOG} mov ${movimientoId}: ${sku} ${cantidad > 0 ? "+" : ""}${cantidad} ` +
        `en ${almacen.nombre_almacen} -> stocked=${nivel.stocked_quantity}`
    )

    res.status(200).json({
      ok: true,
      aplicado: true,
      sku,
      delta: cantidad,
      stocked_quantity: nivel.stocked_quantity,
    })
  } catch (err: any) {
    // No se marca empujado_a_medusa: el movimiento queda visible en la vista
    // "Sin sincronizar a Medusa" para reintentar.
    console.error(`${LOG} error en mov ${movimientoId}:`, err?.message)
    res.status(500).json({ ok: false, error: err?.message })
  }
}

/** NocoDB prueba los webhooks con GET desde la interfaz. */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.status(200).json({
    ok: true,
    servicio: "puente nocodb -> medusa",
    configurado: Boolean(
      NOCODB_URL && NOCODB_TOKEN && WEBHOOK_SECRET && T_MOVIMIENTOS && T_ALMACENES
    ),
  })
}
