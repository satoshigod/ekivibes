/**
 * src/workflows/steps/mirror-order-to-nocodb.ts
 *
 * Espeja un pedido de Medusa hacia NocoDB, congelando el costo de cada
 * producto en el momento de la venta para poder calcular la utilidad.
 *
 * POR QUE EXISTE: Medusa registra cuanto se vendio, pero no sabe cuanto
 * costo la mercancia. NocoDB lleva el costo promedio ponderado. Cruzando
 * ambos sale la utilidad real por linea, por pedido y por periodo.
 *
 * REGLA CRITICA — no restar el inventario dos veces:
 * Medusa YA descontó el stock al confirmar el pedido. El movimiento que se
 * crea aqui es solo el asiento contable en el ledger, y nace marcado como
 * empujado_a_medusa = true para que el puente lo ignore. Si naciera en
 * false, el puente lo empujaria y restaria de nuevo.
 */

import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

const NOCODB_URL = process.env.NOCODB_URL || ""
const NOCODB_TOKEN = process.env.NOCODB_TOKEN || ""
const T_CLIENTES = process.env.NOCODB_TABLE_CLIENTES || ""
const T_PEDIDOS = process.env.NOCODB_TABLE_PEDIDOS || ""
const T_PEDIDOS_LINEAS = process.env.NOCODB_TABLE_PEDIDOS_LINEAS || ""
const T_PRODUCTOS = process.env.NOCODB_TABLE_PRODUCTOS || ""
const T_ALMACENES = process.env.NOCODB_TABLE_ALMACENES || ""
const T_MOVIMIENTOS = process.env.NOCODB_TABLE_MOVIMIENTOS || ""

const LOG = "[medusa->nocodb:pedido]"

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

/** Los filtros deben ir sobre columnas propias; el campo de enlace no filtra. */
async function buscarUno(tabla: string, campo: string, valor: string) {
  const where = encodeURIComponent(`(${campo},eq,${valor})`)
  const res = await nocodb(`/api/v2/tables/${tabla}/records?where=${where}&limit=1`)
  return (res.list || [])[0] || null
}

/**
 * Igual que buscarUno pero con dos condiciones (AND). Se usa para el cliente:
 * Medusa permite dos Customer distintos con el mismo email, y con dos marcas
 * un correo que compra en ambas no debe fusionarse en el mismo registro de
 * NocoDB solo por coincidir el email. La combinacion email+marca es la
 * identidad real.
 */
async function buscarUnoCompuesto(
  tabla: string,
  condiciones: [string, string][]
) {
  const where = encodeURIComponent(
    condiciones.map(([campo, valor]) => `(${campo},eq,${valor})`).join("~and")
  )
  const res = await nocodb(`/api/v2/tables/${tabla}/records?where=${where}&limit=1`)
  return (res.list || [])[0] || null
}

async function columnas(tabla: string): Promise<Record<string, string>> {
  const meta = await nocodb(`/api/v2/meta/tables/${tabla}`)
  const out: Record<string, string> = {}
  for (const c of meta.columns || []) out[c.title] = c.id
  return out
}

async function enlazar(tabla: string, colId: string, registro: number, destino: number) {
  await nocodb(`/api/v2/tables/${tabla}/links/${colId}/records/${registro}`, {
    method: "POST",
    body: [{ Id: destino }],
  })
}

function marcaDesdeCanal(nombre?: string): string {
  const n = (nombre || "").toLowerCase()
  return n.includes("hit-air") || n.includes("hitair") ? "Hit-Air Colombia" : "Ekivibes"
}

function canalDesdeNombre(nombre?: string): string {
  const n = (nombre || "").toLowerCase()
  if (n.includes("venta directa")) return "Venta Fisica"
  return "E-commerce"
}

type Input = { order: any }

type Resultado = {
  espejado: boolean
  razon?: string
  pedido_nocodb?: number
  lineas?: number
  sin_producto?: string[]
}

export const mirrorOrderToNocodbStep = createStep(
  "mirror-order-to-nocodb",
  async ({ order }: Input): Promise<StepResponse<Resultado, Resultado>> => {
    if (!NOCODB_URL || !NOCODB_TOKEN || !T_PEDIDOS || !T_PEDIDOS_LINEAS) {
      console.warn(`${LOG} NocoDB no configurado, se omite el espejo`)
      const r: Resultado = { espejado: false, razon: "sin configuracion" }
      return new StepResponse(r, r)
    }

    // Idempotencia: no duplicar si el pedido ya fue espejado.
    const existente = await buscarUno(T_PEDIDOS, "medusa_order_id", order.id)
    if (existente) {
      console.log(`${LOG} pedido ${order.id} ya espejado`)
      const r: Resultado = { espejado: false, razon: "ya existe" }
      return new StepResponse(r, r)
    }

    const nombreCanal: string | undefined = order?.sales_channel?.name
    const marca = marcaDesdeCanal(nombreCanal)
    const canal = canalDesdeNombre(nombreCanal)

    // ---- cliente: se reutiliza por email+marca para no fragmentar el
    // historial dentro de una marca, sin fusionar dos personas distintas
    // que comparten correo en marcas diferentes (ver buscarUnoCompuesto).
    let clienteId: number | null = null
    const email: string | undefined = order.email
    if (T_CLIENTES && email) {
      const hallado = await buscarUnoCompuesto(T_CLIENTES, [
        ["email", email],
        ["marca", marca],
      ])
      if (hallado) {
        clienteId = hallado.Id
      } else {
        const nombre =
          [order?.customer?.first_name, order?.customer?.last_name]
            .filter(Boolean)
            .join(" ") ||
          [order?.shipping_address?.first_name, order?.shipping_address?.last_name]
            .filter(Boolean)
            .join(" ") ||
          email
        const nuevo = await nocodb(`/api/v2/tables/${T_CLIENTES}/records`, {
          method: "POST",
          body: {
            nombre_completo: nombre,
            email,
            telefono: order?.shipping_address?.phone || order?.customer?.phone || null,
            marca,
            tipo_cliente: "E-commerce",
            ciudad: order?.shipping_address?.city || null,
            direccion: order?.shipping_address?.address_1 || null,
            medusa_customer_id: order?.customer_id || null,
            fecha_registro: new Date().toISOString().slice(0, 10),
          },
        })
        clienteId = nuevo.Id
      }
    }

    // ---- cabecera del pedido
    const pedido = await nocodb(`/api/v2/tables/${T_PEDIDOS}/records`, {
      method: "POST",
      body: {
        numero_pedido: String(order.display_id ?? order.id),
        medusa_order_id: order.id,
        fecha_pedido: new Date(order.created_at).toISOString().slice(0, 19).replace("T", " "),
        marca,
        canal,
        estado_pedido: "Pagado",
        estado_pago: "Aprobado",
        metodo_pago: "Wompi",
        subtotal: Number(order.item_total ?? order.subtotal ?? 0),
        costo_envio: Number(order.shipping_total ?? 0),
        total: Number(order.total ?? 0),
        notas: `Espejado desde Medusa. Canal: ${nombreCanal || "?"}`,
      },
    })
    const pedidoId: number = pedido.Id

    const colPedidos = await columnas(T_PEDIDOS)
    if (clienteId && colPedidos["cliente"]) {
      await enlazar(T_PEDIDOS, colPedidos["cliente"], pedidoId, clienteId)
    }

    // ---- almacen que sincroniza (de donde salio la mercancia)
    let almacenId: number | null = null
    if (T_ALMACENES) {
      const alm = await buscarUno(T_ALMACENES, "sincroniza_medusa", "true")
      almacenId = alm ? alm.Id : null
    }

    const colLineas = await columnas(T_PEDIDOS_LINEAS)
    const colMov = T_MOVIMIENTOS ? await columnas(T_MOVIMIENTOS) : {}

    let lineas = 0
    const sinProducto: string[] = []

    for (const item of order.items || []) {
      const sku: string | undefined = item.variant_sku || item?.variant?.sku
      const cantidad = Number(item.quantity) || 0

      // Costo CONGELADO: se copia el promedio ponderado de hoy. No es un
      // lookup en vivo, porque una compra futura a otro precio no debe
      // cambiar la utilidad de una venta ya hecha.
      let productoId: number | null = null
      let costoUnitario = 0
      if (sku && T_PRODUCTOS) {
        const prod = await buscarUno(T_PRODUCTOS, "sku", sku)
        if (prod) {
          productoId = prod.Id
          costoUnitario = Number(prod.costo_promedio_ponderado) || 0
        } else {
          sinProducto.push(sku)
        }
      }

      const linea = await nocodb(`/api/v2/tables/${T_PEDIDOS_LINEAS}/records`, {
        method: "POST",
        body: {
          descripcion: item.title || sku || "(sin titulo)",
          cantidad,
          precio_unitario: Number(item.unit_price ?? 0),
          descuento: Number(item.discount_total ?? 0),
          costo_unitario_venta: costoUnitario,
        },
      })
      const lineaId: number = linea.Id
      if (colLineas["pedido"]) {
        await enlazar(T_PEDIDOS_LINEAS, colLineas["pedido"], lineaId, pedidoId)
      }
      if (productoId && colLineas["producto"]) {
        await enlazar(T_PEDIDOS_LINEAS, colLineas["producto"], lineaId, productoId)
      }
      lineas++

      // ---- asiento en el ledger, YA sincronizado
      if (T_MOVIMIENTOS && productoId && almacenId && cantidad > 0) {
        const mov = await nocodb(`/api/v2/tables/${T_MOVIMIENTOS}/records`, {
          method: "POST",
          body: {
            referencia: String(order.display_id ?? order.id),
            tipo_movimiento: "Salida Venta",
            cantidad: -cantidad,
            origen_movimiento: "Medusa",
            confirmado: true,
            // Medusa ya descontó: se marca empujado para que el puente lo
            // ignore y no reste una segunda vez.
            empujado_a_medusa: true,
            costo_unitario_manual: costoUnitario,
            documento_ref: order.id,
            notas: "Salida generada por venta en tienda web.",
          },
        })
        const movId: number = mov.Id
        for (const [campo, destino] of [
          ["producto", productoId],
          ["almacen", almacenId],
          ["pedido", pedidoId],
          ["linea_pedido", lineaId],
        ] as [string, number][]) {
          if (colMov[campo]) {
            await enlazar(T_MOVIMIENTOS, colMov[campo], movId, destino)
          }
        }
      }
    }

    console.log(
      `${LOG} pedido ${order.display_id}: ${lineas} lineas espejadas` +
        (sinProducto.length ? `, SKU sin producto en NocoDB: ${sinProducto.join(", ")}` : "")
    )

    const r: Resultado = {
      espejado: true,
      pedido_nocodb: pedidoId,
      lineas,
      sin_producto: sinProducto,
    }
    return new StepResponse(r, r)
  }
)
