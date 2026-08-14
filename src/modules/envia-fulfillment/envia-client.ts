/**
 * Cliente HTTP para la API de Envia.com
 * Docs verificadas: https://docs.envia.com (Shipping API + Queries API)
 *
 * Sandbox:
 *   Shipping API -> https://api-test.envia.com
 *   Queries API  -> https://queries-test.envia.com
 * Producción:
 *   Shipping API -> https://api.envia.com
 *   Queries API  -> https://queries.envia.com
 */

export type EnviaAddress = {
  name: string
  company?: string
  phone: string
  email?: string
  street: string
  number?: string
  district?: string
  city: string
  state: string // código de departamento esperado por Envia (ver co-states-map.ts)
  country: string // "CO"
  postalCode: string
  reference?: string
}

export type EnviaPackage = {
  type: "box" | "envelope" | "pallet"
  content: string
  amount: number
  declaredValue: number
  lengthUnit: "CM"
  weightUnit: "KG"
  weight: number
  dimensions: { length: number; width: number; height: number }
}

export type EnviaCarrier = "servientrega" | "coordinadora" | "interrapidisimo"

export type EnviaRateRequest = {
  origin: EnviaAddress
  destination: EnviaAddress
  packages: EnviaPackage[]
  carrier: EnviaCarrier
}

export type EnviaRateOption = {
  carrier: string
  service: string
  serviceDescription?: string
  deliveryEstimate?: string
  totalPrice: string
  currency: string
}

export type EnviaGenerateRequest = EnviaRateRequest & { service: string }

export type EnviaShipment = {
  carrier: string
  service: string
  shipmentId: number
  trackingNumber: string
  trackUrl: string
  label: string
  totalPrice: number
  currency: string
}

export type EnviaTrackEvent = {
  timestamp: string
  location?: string
  description: string
}

export type EnviaTrackResult = {
  trackingNumber: string
  status: string
  carrier: string
  events: EnviaTrackEvent[]
}

export type EnviaClientOptions = {
  apiToken: string
  shippingBase: string // https://api-test.envia.com | https://api.envia.com
  queriesBase: string // https://queries-test.envia.com | https://queries.envia.com
}

export type EnviaPickupRequest = {
  carrier: string
  pickupAddress: EnviaAddress
  pickupDate: string // "YYYY-MM-DD"
  pickupTimeStart: string // "HH:mm"
  pickupTimeEnd: string // "HH:mm"
  trackingNumbers: string[] // deben ser del mismo carrier y mismo origen
}

export type EnviaPickupResult = {
  carrier: string
  confirmation: string
  status: string
  date: string
  timeFrom: number
  timeTo: number
}

export class EnviaClient {
  private apiToken: string
  private shippingBase: string
  private queriesBase: string

  constructor(options: EnviaClientOptions) {
    this.apiToken = options.apiToken
    this.shippingBase = options.shippingBase.replace(/\/$/, "")
    this.queriesBase = options.queriesBase.replace(/\/$/, "")
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    // La Shipping API devuelve texto plano "Authentication error." con 401,
    // y la Queries API devuelve JSON con statusCode/error/message.
    if (!res.ok) {
      const raw = await res.text()
      throw new Error(
        `Envia API error (${res.status}) on ${path}: ${raw.slice(0, 500)}`
      )
    }

    return res.json() as Promise<T>
  }

  /** POST /ship/rate/ — cotización, UN carrier por request */
  async rate(req: EnviaRateRequest): Promise<EnviaRateOption[]> {
    const result = await this.request<{ meta: string; data: EnviaRateOption[] }>(
      this.shippingBase,
      "/ship/rate/",
      {
        origin: req.origin,
        destination: req.destination,
        packages: req.packages,
        shipment: { type: 1, carrier: req.carrier },
      }
    )
    return result.data ?? []
  }

  /** POST /ship/generate/ — compra la guía y devuelve tracking + PDF */
  async generate(req: EnviaGenerateRequest): Promise<EnviaShipment> {
    const result = await this.request<{ meta: string; data: EnviaShipment[] }>(
      this.shippingBase,
      "/ship/generate/",
      {
        origin: req.origin,
        destination: req.destination,
        packages: req.packages,
        shipment: { type: 1, carrier: req.carrier, service: req.service },
        // "settings" es obligatorio en /ship/generate/ (a diferencia de
        // /ship/rate/, que no lo pide). printSize STOCK_4X6 es el formato
        // térmico estándar 4x6"; cambiar si tu impresora usa otro tamaño.
        settings: { printFormat: "PDF", printSize: "STOCK_4X6", currency: "COP" },
      }
    )
    const shipment = result.data?.[0]
    if (!shipment) {
      throw new Error(
        `Envia /ship/generate/ no devolvió ningún shipment. Respuesta cruda: ${JSON.stringify(
          result
        )}`
      )
    }
    return shipment
  }

  /** POST /ship/generaltrack/ — estado + histórico de eventos */
  async track(trackingNumbers: string[]): Promise<EnviaTrackResult[]> {
    const result = await this.request<{ meta: string; data: EnviaTrackResult[] }>(
      this.shippingBase,
      "/ship/generaltrack/",
      { trackingNumbers }
    )
    return result.data ?? []
  }

  /** POST /ship/cancel/ — anula una guía */
  async cancel(carrier: string, trackingNumber: string): Promise<void> {
    await this.request(this.shippingBase, "/ship/cancel/", {
      carrier,
      trackingNumber,
    })
  }

  /**
   * POST /ship/pickup/ — payload verificado contra la Guía de Pickup &
   * Manifest de Envia.com. Todos los trackingNumbers deben ser del mismo
   * carrier y mismo origen.
   */
  async pickup(req: EnviaPickupRequest): Promise<EnviaPickupResult> {
    const result = await this.request<{ meta: string; data: EnviaPickupResult }>(
      this.shippingBase,
      "/ship/pickup/",
      {
        carrier: req.carrier,
        pickupAddress: req.pickupAddress,
        pickupDate: req.pickupDate,
        pickupTimeStart: req.pickupTimeStart,
        pickupTimeEnd: req.pickupTimeEnd,
        trackingNumbers: req.trackingNumbers,
      }
    )
    return result.data
  }

  /** Registrar webhook de tracking en la Queries API (una vez, no por request) */
  async registerWebhook(typeId: number, url: string): Promise<unknown> {
    return this.request(this.queriesBase, "/webhooks", {
      type_id: typeId,
      url,
      active: 1,
    })
  }
}
