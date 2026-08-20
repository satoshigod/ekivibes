/**
 * src/api/hooks/nocodb/linea-venta/route.ts
 *
 * CONGELA EL COSTO AL REGISTRAR UNA VENTA FISICA O MAYORISTA
 * ===========================================================
 *
 * En una venta web el costo lo pone el subscriber que espeja el pedido. En
 * una venta de mostrador o mayorista, registrada a mano en NocoDB, habia que
 * copiarlo del producto a la linea: un paso manual y facil de olvidar. Una
 * linea sin costo aparece con 100% de utilidad y distorsiona el estado de
 * resultados de todo el periodo.
 *
 * Al crear o enlazar una linea de venta, este endpoint le copia el costo
 * promedio ponderado que tiene el producto en ese momento.
 *
 * POR QUE SE COPIA Y NO SE CONSULTA EN VIVO: si fuera un lookup, cada compra
 * futura a otro precio cambiaria la utilidad de ventas ya cerradas. La
 * utilidad de marzo debe seguir siendo la de marzo.
 *
 * Solo actua si el costo esta vacio: un costo puesto a mano no se pisa.
 *
 * VARIABLES DE ENTORNO: las del puente, mas NOCODB_TABLE_PEDIDOS_LINEAS y
 * NOCODB_TABLE_PRODUCTOS.
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import crypto from "crypto"

const NOCODB_URL = process.env.NOCODB_URL || ""
const NOCODB_TOKEN = process.env.NOCODB_TOKEN || ""
const WEBHOOK_SECRET = process.env.NOCODB_WEBHOOK_SECRET || ""
const T_LINEAS = process.env.NOCODB_TABLE_PEDIDOS_LINEAS || ""
const T_PRODUCTOS = process.env.NOCODB_TABLE_PRODUCTOS || ""

const LOG = "[nocodb:linea-venta]"

function secretoValido(recibido: unknown): boolean {
  if (!WEBHOOK_SECRET || typeof recibido !== "string") {
    return false
  }
  const a = Buffer.from(recibido)
  const b = Buffer.from(WEBHOOK_SECRET)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

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

function extraerId(body: any): number | null {
  const crudo =
    body?.linea_id ??
    body?.data?.data?.rows?.[0]?.Id ??
    body?.data?.rows?.[0]?.Id ??
    body?.Id
  const n = Number(crudo)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Copia el costo del producto a una linea. Devuelve si lo aplico. */
async function asignarCosto(lineaId: number) {
  const linea = await nocodb(`/api/v2/tables/${T_LINEAS}/records/${lineaId}`)

  // Un costo ya puesto no se pisa: puede ser un ajuste deliberado.
  if (linea.costo_unitario_venta != null && Number(linea.costo_unitario_venta) > 0) {
    return { linea_id: lineaId, aplicado: false, razon: "ya tiene costo" }
  }
  if (!linea.productos_id) {
    return { linea_id: lineaId, aplicado: false, razon: "sin producto" }
  }

  const prod = await nocodb(
    `/api/v2/tables/${T_PRODUCTOS}/records/${linea.productos_id}`
  )
  const costo = Number(prod.costo_promedio_ponderado) || 0
  if (costo <= 0) {
    console.warn(`${LOG} ${prod.sku} no tiene costo; la linea queda sin costear`)
    return { linea_id: lineaId, aplicado: false, razon: `${prod.sku} sin costo` }
  }

  await nocodb(`/api/v2/tables/${T_LINEAS}/records`, {
    method: "PATCH",
    body: [{ Id: lineaId, costo_unitario_venta: costo }],
  })
  console.log(`${LOG} linea ${lineaId}: ${prod.sku} costeada a ${costo}`)
  return { linea_id: lineaId, aplicado: true, sku: prod.sku, costo }
}

/**
 * Lineas de venta sin costo.
 *
 * El filtro es "blank", no "eq,0": el campo llega NULL, y eq,0 no lo detecta
 * (devuelve cero resultados en silencio). Esto tambien recoge las lineas que
 * quedaron sin costear porque el webhook disparo en el insert, antes de que
 * se estableciera el enlace al producto.
 */
async function pendientes(excluir: number): Promise<number[]> {
  const where = encodeURIComponent("(costo_unitario_venta,blank)")
  const res = await nocodb(
    `/api/v2/tables/${T_LINEAS}/records?where=${where}&limit=50`
  )
  return (res.list || [])
    .map((l: any) => Number(l.Id))
    .filter((id: number) => Number.isFinite(id) && id !== excluir)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!secretoValido(req.headers["x-nocodb-secret"])) {
    res.status(401).json({ error: "no autorizado" })
    return
  }
  if (!NOCODB_URL || !NOCODB_TOKEN || !T_LINEAS || !T_PRODUCTOS) {
    res.status(500).json({ error: "configuracion incompleta" })
    return
  }

  const lineaId = extraerId(req.body)
  if (!lineaId) {
    res.status(400).json({ error: "linea_id ausente" })
    return
  }

  try {
    const principal = await asignarCosto(lineaId)

    // El webhook solo avisa de la primera fila de una edicion en lote.
    const otros: any[] = []
    for (const id of await pendientes(lineaId)) {
      try {
        otros.push(await asignarCosto(id))
      } catch (e: any) {
        otros.push({ linea_id: id, aplicado: false, error: e?.message })
      }
    }

    res.status(200).json({ ok: true, ...principal, barrido: otros.length, detalle: otros })
  } catch (err: any) {
    console.error(`${LOG} error en linea ${lineaId}:`, err?.message)
    res.status(500).json({ ok: false, error: err?.message })
  }
}

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.status(200).json({
    ok: true,
    servicio: "costeo de lineas de venta",
    configurado: Boolean(NOCODB_URL && NOCODB_TOKEN && WEBHOOK_SECRET && T_LINEAS && T_PRODUCTOS),
  })
}
