/**
 * src/api/hooks/nocodb/recepcion-compra/route.ts
 *
 * GENERA LOS MOVIMIENTOS DE INVENTARIO DE UNA COMPRA
 * ===================================================
 *
 * Problema que resuelve: al recibir mercancia habia que crear a mano un
 * movimiento por cada linea de la compra, repitiendo producto, cantidad,
 * almacen y costo que el sistema ya conoce. Con una importacion de quince
 * productos son noventa campos digitados y noventa oportunidades de error.
 *
 * Disparador: NocoDB llama a este endpoint cuando una compra pasa a tener
 * fecha_recepcion. Por cada linea se crea un movimiento de Entrada Compra
 * con todo enlazado, en estado SIN confirmar.
 *
 * Los movimientos NO se confirman solos, a proposito: recibir mercancia es
 * el momento de contarla. El usuario revisa la lista, ajusta cantidades si
 * llegaron diferentes, y confirma. Al confirmar, el webhook de movimientos
 * empuja el stock a Medusa.
 *
 * IDEMPOTENCIA: si la compra ya tiene movimientos, no se duplican. Se puede
 * reeditar fecha_recepcion sin miedo.
 *
 * VARIABLES DE ENTORNO: las mismas del puente de movimientos, mas
 *   NOCODB_TABLE_COMPRAS
 *   NOCODB_TABLE_COMPRAS_LINEAS
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import crypto from "crypto"

const NOCODB_URL = process.env.NOCODB_URL || ""
const NOCODB_TOKEN = process.env.NOCODB_TOKEN || ""
const WEBHOOK_SECRET = process.env.NOCODB_WEBHOOK_SECRET || ""
const T_COMPRAS = process.env.NOCODB_TABLE_COMPRAS || ""
const T_LINEAS = process.env.NOCODB_TABLE_COMPRAS_LINEAS || ""
const T_MOVIMIENTOS = process.env.NOCODB_TABLE_MOVIMIENTOS || ""

const LOG = "[nocodb:recepcion]"

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

/** Los ids de columna de enlace se resuelven por nombre, no se hardcodean. */
async function columnasEnlace(tablaId: string): Promise<Record<string, string>> {
  const meta = await nocodb(`/api/v2/meta/tables/${tablaId}`)
  const out: Record<string, string> = {}
  for (const c of meta.columns || []) {
    out[c.title] = c.id
  }
  return out
}

function extraerId(body: any): number | null {
  const crudo =
    body?.compra_id ??
    body?.data?.data?.rows?.[0]?.Id ??
    body?.data?.rows?.[0]?.Id ??
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
  if (!NOCODB_URL || !NOCODB_TOKEN || !T_COMPRAS || !T_LINEAS || !T_MOVIMIENTOS) {
    console.error(`${LOG} faltan variables de entorno`)
    res.status(500).json({ error: "configuracion incompleta" })
    return
  }

  const compraId = extraerId(req.body)
  if (!compraId) {
    res.status(400).json({ error: "compra_id ausente" })
    return
  }

  try {
    const compra = await nocodb(`/api/v2/tables/${T_COMPRAS}/records/${compraId}`)

    if (!compra.fecha_recepcion) {
      res.status(200).json({ ok: true, creados: 0, razon: "sin fecha_recepcion" })
      return
    }
    if (!compra.almacenes_id) {
      res.status(200).json({ ok: true, creados: 0, razon: "sin almacen_destino" })
      return
    }

    // Idempotencia: si ya hay movimientos de esta compra, no se repite.
    // Se filtra por la clave foranea compras_id, no por el campo de enlace
    // "compra": filtrar por el link devuelve cero resultados en silencio.
    const yaHay = await nocodb(
      `/api/v2/tables/${T_MOVIMIENTOS}/records?where=` +
        encodeURIComponent(`(compras_id,eq,${compraId})`) +
        `&limit=1`
    )
    if ((yaHay.list || []).length) {
      console.log(`${LOG} compra ${compraId} ya tiene movimientos`)
      res.status(200).json({ ok: true, creados: 0, razon: "ya generados" })
      return
    }

    const lineas = await nocodb(
      `/api/v2/tables/${T_LINEAS}/records?where=` +
        encodeURIComponent(`(compras_id,eq,${compraId})`) +
        `&limit=200`
    )
    const filas = lineas.list || []
    if (!filas.length) {
      res.status(200).json({ ok: true, creados: 0, razon: "compra sin lineas" })
      return
    }

    const colMov = await columnasEnlace(T_MOVIMIENTOS)
    let creados = 0
    const omitidas: string[] = []

    for (const l of filas) {
      if (!l.productos_id) {
        omitidas.push(`linea ${l.Id}: sin producto`)
        continue
      }
      const cantidad = Number(l.cantidad)
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        omitidas.push(`linea ${l.Id}: cantidad invalida`)
        continue
      }

      const nuevo = await nocodb(`/api/v2/tables/${T_MOVIMIENTOS}/records`, {
        method: "POST",
        body: {
          referencia: compra.numero_compra || `compra-${compraId}`,
          tipo_movimiento: "Entrada Compra",
          cantidad,
          origen_movimiento: "n8n",
          documento_ref: compra.numero_factura_proveedor || null,
          notas: "Generado automaticamente al registrar la recepcion.",
        },
      })
      const movId = nuevo.Id

      const enlaces: [string, number][] = [
        ["compra", compraId],
        ["linea_compra", l.Id],
        ["producto", l.productos_id],
        ["almacen", compra.almacenes_id],
      ]
      for (const [campo, destino] of enlaces) {
        if (!colMov[campo]) continue
        await nocodb(
          `/api/v2/tables/${T_MOVIMIENTOS}/links/${colMov[campo]}/records/${movId}`,
          { method: "POST", body: [{ Id: destino }] }
        )
      }
      creados++
    }

    console.log(
      `${LOG} compra ${compraId}: ${creados} movimientos creados` +
        (omitidas.length ? `, ${omitidas.length} omitidas` : "")
    )
    res.status(200).json({ ok: true, creados, omitidas })
  } catch (err: any) {
    console.error(`${LOG} error en compra ${compraId}:`, err?.message)
    res.status(500).json({ ok: false, error: err?.message })
  }
}

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.status(200).json({
    ok: true,
    servicio: "generador de movimientos por recepcion de compra",
    configurado: Boolean(
      NOCODB_URL && NOCODB_TOKEN && WEBHOOK_SECRET && T_COMPRAS && T_LINEAS && T_MOVIMIENTOS
    ),
  })
}
