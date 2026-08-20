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
 * BARRIDO DE PENDIENTES:
 *  - La plantilla del webhook de NocoDB solo manda la PRIMERA fila de la
 *    operacion ({{ data.data.rows.0.Id }}). Si alguien confirma varios
 *    movimientos a la vez, los demas nunca llegarian y el stock quedaria
 *    corto en silencio.
 *  - Por eso, ademas del movimiento avisado, se procesan todos los que esten
 *    confirmados y sin empujar. Eso cubre ediciones en lote, webhooks
 *    perdidos por un redespliegue y reintentos manuales.
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

type Resultado = {
  movimiento_id: number
  aplicado: boolean
  sku?: string
  delta?: number
  stocked_quantity?: number
  razon?: string
  error?: string
}

/** Procesa un movimiento. No lanza: devuelve el resultado para poder seguir. */
async function procesarMovimiento(
  movimientoId: number,
  scope: MedusaRequest["scope"]
): Promise<Resultado> {
  try {
    const mov = await nocodb(
      `/api/v2/tables/${T_MOVIMIENTOS}/records/${movimientoId}`
    )

    if (mov.empujado_a_medusa === true || mov.empujado_a_medusa === 1) {
      return { movimiento_id: movimientoId, aplicado: false, razon: "ya sincronizado" }
    }
    if (!(mov.confirmado === true || mov.confirmado === 1)) {
      return { movimiento_id: movimientoId, aplicado: false, razon: "no confirmado" }
    }

    const cantidad = Number(mov.cantidad)
    if (!Number.isFinite(cantidad) || cantidad === 0) {
      return { movimiento_id: movimientoId, aplicado: false, razon: "cantidad nula" }
    }

    const sku: string | undefined = mov?.producto?.sku
    if (!sku) {
      return { movimiento_id: movimientoId, aplicado: false, razon: "sin producto" }
    }
    if (!mov.almacenes_id) {
      return { movimiento_id: movimientoId, aplicado: false, razon: "sin almacen" }
    }

    const almacen = await nocodb(
      `/api/v2/tables/${T_ALMACENES}/records/${mov.almacenes_id}`
    )
    const sincroniza =
      almacen.sincroniza_medusa === true || almacen.sincroniza_medusa === 1
    if (!sincroniza) {
      await nocodb(`/api/v2/tables/${T_MOVIMIENTOS}/records`, {
        method: "PATCH",
        body: [{ Id: movimientoId, empujado_a_medusa: true }],
      })
      return { movimiento_id: movimientoId, aplicado: false, razon: "almacen local" }
    }

    const locationId: string | undefined = almacen.medusa_location_id
    if (!locationId) {
      return {
        movimiento_id: movimientoId,
        aplicado: false,
        error: `almacen "${almacen.nombre_almacen}" sin medusa_location_id`,
      }
    }

    const query = scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: items } = await query.graph({
      entity: "inventory_item",
      fields: ["id", "sku", "variants.sku"],
      filters: { variants: { sku } } as any,
    })
    if (!items?.length) {
      return { movimiento_id: movimientoId, aplicado: false, error: `SKU ${sku} sin inventario` }
    }
    if (items.length > 1) {
      return { movimiento_id: movimientoId, aplicado: false, error: `SKU ${sku} duplicado` }
    }

    // Lock sobre el inventory_item: si una venta esta reservando o ajustando
    // el mismo SKU al mismo tiempo, este ajuste espera su turno en vez de
    // pisar la mutacion. Sin esto, Medusa usa el proveedor en memoria (no
    // apto para produccion) y el ajuste corre sin ninguna serializacion.
    const lockingService = scope.resolve(Modules.LOCKING)
    const inventoryService: IInventoryService = scope.resolve(Modules.INVENTORY)
    const lockKey = items[0].id
    await lockingService.acquire(lockKey, { expire: 10 })
    let nivel
    try {
      nivel = await inventoryService.adjustInventory(lockKey, locationId, cantidad)
    } finally {
      await lockingService.release(lockKey)
    }

    await nocodb(`/api/v2/tables/${T_MOVIMIENTOS}/records`, {
      method: "PATCH",
      body: [{ Id: movimientoId, empujado_a_medusa: true }],
    })

    console.log(
      `${LOG} mov ${movimientoId}: ${sku} ${cantidad > 0 ? "+" : ""}${cantidad} -> ${nivel.stocked_quantity}`
    )
    return {
      movimiento_id: movimientoId,
      aplicado: true,
      sku,
      delta: cantidad,
      stocked_quantity: nivel.stocked_quantity,
    }
  } catch (err: any) {
    console.error(`${LOG} error en mov ${movimientoId}:`, err?.message)
    return { movimiento_id: movimientoId, aplicado: false, error: err?.message }
  }
}

/** Movimientos confirmados que aun no llegaron a Medusa. */
async function pendientes(excluir: number): Promise<number[]> {
  const where = encodeURIComponent("(confirmado,eq,true)~and(empujado_a_medusa,eq,false)")
  const res = await nocodb(
    `/api/v2/tables/${T_MOVIMIENTOS}/records?where=${where}&limit=50`
  )
  return (res.list || [])
    .map((m: any) => Number(m.Id))
    .filter((id: number) => Number.isFinite(id) && id !== excluir)
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
    const principal = await procesarMovimiento(movimientoId, req.scope)

    // Barrido: el webhook solo avisa de la primera fila de una edicion en
    // lote, asi que se recogen los demas confirmados sin empujar.
    const otros: Resultado[] = []
    for (const id of await pendientes(movimientoId)) {
      otros.push(await procesarMovimiento(id, req.scope))
    }

    const aplicados = [principal, ...otros].filter((x) => x.aplicado)
    if (otros.length) {
      console.log(`${LOG} barrido: ${otros.length} pendientes procesados`)
    }

    res.status(200).json({
      ok: true,
      ...principal,
      barrido: otros.length,
      aplicados_total: aplicados.length,
      detalle: otros,
    })
  } catch (err: any) {
    console.error(`${LOG} error general:`, err?.message)
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
