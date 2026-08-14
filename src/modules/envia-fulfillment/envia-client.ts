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
      }
    )
    const shipment = result.data?.[0]
    if (!shipment) {
      throw new Error("Envia /ship/generate/ no devolvió ningún shipment")
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

  /** Registrar webhook de tracking en la Queries API (una vez, no por request) */
  async registerWebhook(typeId: number, url: string): Promise<unknown> {
    return this.request(this.queriesBase, "/webhooks", {
      type_id: typeId,
      url,
      active: 1,
    })
  }
}
