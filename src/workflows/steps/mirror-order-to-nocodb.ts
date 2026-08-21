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

class NocodbError extends Error {
  status: number
  body: any
  constructor(status: number, path: string, bodyText: string) {
    super(`NocoDB ${status} en ${path}: ${bodyText}`)
    this.status = status
    try {
      this.body = JSON.parse(bodyText)
    } catch {
      this.body = null
    }
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * NocoDB limita a 5 solicitudes por segundo por usuario. Se serializan las
 * llamadas con una separacion minima para no llegar al limite, en vez de
 * dispararlas lo mas rapido posible y depender del reintento.
 */
const MIN_MS_ENTRE_LLAMADAS = 220
let ultimaLlamada = 0
let cola: Promise<unknown> = Promise.resolve()

async function estrangular<T>(fn: () => Promise<T>): Promise<T> {
  const turno = cola.then(async () => {
    const espera = MIN_MS_ENTRE_LLAMADAS - (Date.now() - ultimaLlamada)
    if (espera > 0) await dormir(espera)
    ultimaLlamada = Date.now()
    return fn()
  })
  // La cola no debe romperse si un turno falla; el error se propaga al llamador.
  cola = turno.catch(() => undefined)
  return turno as Promise<T>
}

const MAX_REINTENTOS_429 = 4

async function nocodb(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<any> {
  return estrangular(async () => {
    for (let intento = 0; ; intento++) {
      const res = await peticion(path, init)
      if (res.status !== 429) return res.parsed

      if (intento >= MAX_REINTENTOS_429) {
        throw new NocodbError(429, path, res.text)
      }
      // NocoDB pide esperar; se respeta Retry-After si viene, si no se sube
      // en escalera. Es preferible tardar unos segundos a dejar un pedido
      // espejado a medias.
      const retryAfter = Number(res.retryAfter)
      const espera = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30000, 1000 * Math.pow(2, intento))
      console.log(`${LOG} 429 en ${path}, reintento ${intento + 1} en ${espera}ms`)
      await dormir(espera)
    }
  })
}

async function peticion(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${NOCODB_URL}${path}`, {
    method: init?.method || "GET",
    headers: { "xc-token": NOCODB_TOKEN, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  // El 429 no se lanza aqui: lo maneja el bucle de reintentos de nocodb().
  if (res.status === 429) {
    return {
      status: 429,
      text: await res.text(),
      retryAfter: res.headers.get("retry-after"),
      parsed: null,
    }
  }
  if (!res.ok) {
    throw new NocodbError(res.status, path, await res.text())
  }
  return { status: res.status, text: "", retryAfter: null, parsed: await res.json() }
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


/**
 * El almacen que sincroniza con Medusa no cambia entre pedidos. Se cachea
 * con vencimiento corto, para recoger un cambio de configuracion sin
 * necesidad de redesplegar.
 */
let cacheAlmacen: { id: number | null; expira: number } | null = null
const TTL_ALMACEN_MS = 5 * 60 * 1000

async function almacenSincronizado(): Promise<number | null> {
  if (!T_ALMACENES) return null
  if (cacheAlmacen && Date.now() < cacheAlmacen.expira) return cacheAlmacen.id
  const alm = await buscarUno(T_ALMACENES, "sincroniza_medusa", "true")
  const id = alm ? alm.Id : null
  cacheAlmacen = { id, expira: Date.now() + TTL_ALMACEN_MS }
  return id
}

/**
 * Busca varios SKU en una sola llamada con el operador `in`, en vez de una
 * llamada por linea del pedido. Devuelve un mapa sku -> registro.
 */
async function buscarProductosPorSku(tabla: string, skus: string[]) {
  const mapa = new Map<string, any>()
  const unicos = [...new Set(skus.filter(Boolean))]
  if (!unicos.length) return mapa
  const where = encodeURIComponent(`(sku,in,${unicos.join(",")})`)
  const res = await nocodb(
    `/api/v2/tables/${tabla}/records?where=${where}&limit=${unicos.length}`
  )
  for (const r of res.list || []) mapa.set(r.sku, r)
  return mapa
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
    // Si dos ejecuciones concurrentes llegan aqui a la vez (reintento del
    // evento, dos instancias, etc.), el SELECT de idempotencia de arriba
    // pudo pasar en ambas antes de que cualquiera insertara. El indice
    // unico en medusa_order_id es quien realmente decide: si el insert
    // choca, ya existe el pedido y se trata como exito, no como error.
    let pedido
    try {
      pedido = await nocodb(`/api/v2/tables/${T_PEDIDOS}/records`, {
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
          // El enlace al cliente se establece con la columna FK en el mismo
          // insert, en vez de una llamada aparte al endpoint /links.
          ...(clienteId ? { clientes_id: clienteId } : {}),
        },
      })
    } catch (err) {
      if (err instanceof NocodbError && err.body?.error === "FIELD_UNIQUE_CONSTRAINT_VIOLATION") {
        console.log(`${LOG} colision de indice unico para ${order.id}, ya existia`)
        const r: Resultado = { espejado: false, razon: "ya existe (colision de indice)" }
        return new StepResponse(r, r)
      }
      throw err
    }
    const pedidoId: number = pedido.Id

    // ---- almacen que sincroniza (de donde salio la mercancia)
    const almacenId = await almacenSincronizado()

    let lineas = 0
    const sinProducto: string[] = []
    const items = order.items || []

    // Un solo lookup para todos los SKU del pedido, en vez de uno por linea.
    const skus = items
      .map((i: any) => i.variant_sku || i?.variant?.sku)
      .filter(Boolean) as string[]
    const productosPorSku = T_PRODUCTOS
      ? await buscarProductosPorSku(T_PRODUCTOS, skus)
      : new Map<string, any>()

    // Se arman todas las filas primero y se insertan en lote. Las relaciones
    // se establecen escribiendo la columna FK dentro del mismo insert
    // (verificado contra la API v2: al leer el registro, el campo de enlace
    // ya viene resuelto), lo que elimina las llamadas de enlace una por una.
    const filasLinea: any[] = []
    const contexto: {
      cantidad: number
      costoUnitario: number
      productoId: number | null
    }[] = []

    for (const item of items) {
      const sku: string | undefined = item.variant_sku || item?.variant?.sku
      const cantidad = Number(item.quantity) || 0

      // Costo CONGELADO: se copia el promedio ponderado de hoy. No es un
      // lookup en vivo, porque una compra futura a otro precio no debe
      // cambiar la utilidad de una venta ya hecha.
      let productoId: number | null = null
      let costoUnitario = 0
      if (sku) {
        const prod = productosPorSku.get(sku)
        if (prod) {
          productoId = prod.Id
          costoUnitario = Number(prod.costo_promedio_ponderado) || 0
        } else if (T_PRODUCTOS) {
          sinProducto.push(sku)
        }
      }

      filasLinea.push({
        descripcion: item.title || sku || "(sin titulo)",
        cantidad,
        precio_unitario: Number(item.unit_price ?? 0),
        descuento: Number(item.discount_total ?? 0),
        costo_unitario_venta: costoUnitario,
        pedidos_facturacion_id: pedidoId,
        ...(productoId ? { productos_id: productoId } : {}),
      })
      contexto.push({ cantidad, costoUnitario, productoId })
    }

    if (filasLinea.length) {
      // El insert masivo devuelve los Id en el mismo orden de envio
      // (verificado contra la API v2), asi que el indice alinea cada Id
      // con su contexto.
      const creadas = await nocodb(`/api/v2/tables/${T_PEDIDOS_LINEAS}/records`, {
        method: "POST",
        body: filasLinea,
      })
      const idsLinea: number[] = (Array.isArray(creadas) ? creadas : [creadas]).map(
        (r: any) => r.Id
      )
      lineas = idsLinea.length

      // ---- asientos en el ledger, YA sincronizados
      if (T_MOVIMIENTOS && almacenId) {
        const filasMov = contexto
          .map((c, idx) =>
            c.productoId && c.cantidad > 0
              ? {
                  referencia: String(order.display_id ?? order.id),
                  tipo_movimiento: "Salida Venta",
                  cantidad: -c.cantidad,
                  origen_movimiento: "Medusa",
                  confirmado: true,
                  // Medusa ya descontó: se marca empujado para que el puente
                  // lo ignore y no reste una segunda vez.
                  empujado_a_medusa: true,
                  costo_unitario_manual: c.costoUnitario,
                  documento_ref: order.id,
                  notas: "Salida generada por venta en tienda web.",
                  productos_id: c.productoId,
                  almacenes_id: almacenId,
                  pedidos_facturacion_id: pedidoId,
                  pedidos_lineas_id: idsLinea[idx],
                }
              : null
          )
          .filter(Boolean)

        if (filasMov.length) {
          await nocodb(`/api/v2/tables/${T_MOVIMIENTOS}/records`, {
            method: "POST",
            body: filasMov,
          })
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
