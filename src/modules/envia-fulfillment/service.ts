import { AbstractFulfillmentProviderService, ContainerRegistrationKeys } from "@medusajs/framework/utils"
// redeploy trigger
import type { Logger, Query } from "@medusajs/framework/types"
import type {
  CreateFulfillmentResult,
  CreateShippingOptionDTO,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  ValidateFulfillmentDataContext,
} from "@medusajs/framework/types"
import {
  EnviaClient,
  EnviaAddress,
  EnviaCarrier,
  EnviaPackage,
} from "./envia-client"
import { resolveEnviaState } from "./co-states-map"

type InjectedDependencies = {
  logger: Logger
  query: Query
}

export type EnviaFulfillmentOptions = {
  apiToken: string
  env: "sandbox" | "production"
  shippingBase: string
  queriesBase: string
  origin: {
    name: string
    phone: string
    street: string
    city: string
    state: string
    postalCode: string
    country: string
  }
  defaultPackage: {
    weightKg: number
    lengthCm: number
    widthCm: number
    heightCm: number
    declaredValue: number
  }
}

// Carriers colombianos habilitados — deben existir así de exactos en tu
// cuenta de Envia.com (Panel > Configuraciones > Paqueterías). Confirmar el
// slug real contra GET /available-couriers en la Queries API si un rate
// devuelve vacío.
const CARRIERS: { id: EnviaCarrier; name: string }[] = [
  { id: "servientrega", name: "Servientrega" },
  { id: "coordinadora", name: "Coordinadora" },
  { id: "interrapidisimo", name: "Inter Rapidísimo" },
]

class EnviaFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "envia-fulfillment"

  protected logger_: Logger
  protected query_: Query
  protected options_: EnviaFulfillmentOptions
  protected client_: EnviaClient

  constructor(cradle: InjectedDependencies, options: EnviaFulfillmentOptions) {
    super()
    this.logger_ = cradle.logger
    this.options_ = options
    // Acceso defensivo: si "query" no está disponible en el contenedor de
    // este provider, no queremos que el servidor falle al arrancar — el
    // método que lo usa ya tiene su propio fallback al snapshot de la orden.
    try {
      this.query_ = cradle.query
    } catch {
      this.query_ = undefined as unknown as Query
    }
    this.client_ = new EnviaClient({
      apiToken: options.apiToken,
      shippingBase: options.shippingBase,
      queriesBase: options.queriesBase,
    })
  }

  /**
   * Un "fulfillment option" por carrier — solo para GENERAR GUÍAS, no para
   * cotizar. En Admin, crea las shipping options con price_type "flat"
   * (tarifa fija $18.000 / gratis sobre $250.000 vía Price Rules nativas de
   * Medusa: docs.medusajs.com/resources/commerce-modules/pricing/price-rules)
   * y asigna este provider — el precio NUNCA sale de Envia.
   */
  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return CARRIERS.map((c) => ({
      id: c.id,
      name: c.name,
      is_return: false,
    }))
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext
  ): Promise<any> {
    if (!context.shipping_address?.city || !context.shipping_address?.province) {
      throw new Error(
        "Se requiere ciudad y departamento en la dirección de envío para generar la guía con Envia.com"
      )
    }
    return data
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return CARRIERS.some((c) => c.id === (data.id as string))
  }

  /**
   * false a propósito: el precio de envío es fijo (price_type "flat" +
   * Price Rules en Medusa Admin), Envia.com NO cotiza en el checkout. Si
   * alguien intenta crear una shipping option "calculated" con este
   * provider, Medusa lo rechaza — es la señal correcta.
   */
  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return false
  }

  /**
   * Se ejecuta cuando el Admin marca la orden como "Create fulfillment".
   * Compra la guía real en Envia.com y devuelve tracking + PDF, que Medusa
   * guarda nativamente en fulfillment.labels. Usa SIEMPRE el peso/dimensiones
   * por defecto (ENVIA_DEFAULT_*) — no calcula desde el carrito.
   */
  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const carrier = await this.inferCarrierFromShippingMethod(order, data)
    const address = order?.shipping_address

    if (!address?.city || !address?.province || !address?.postal_code) {
      throw new Error(
        `No se puede generar guía Envia.com: dirección incompleta en la orden ${order?.id}`
      )
    }

    const origin = this.buildOriginAddress()
    const destination: EnviaAddress = {
      name: `${address.first_name ?? ""} ${address.last_name ?? ""}`.trim() || "Cliente",
      phone: address.phone ?? "",
      street: [address.address_1, address.address_2].filter(Boolean).join(" ") || "N/A",
      number: "S/N", // Medusa no captura un campo "número" separado en checkout
      city: address.city,
      state: resolveEnviaState(address.province),
      country: address.country_code?.toUpperCase() ?? "CO",
      postalCode: address.postal_code,
    }

    const packages = this.buildDefaultPackages()
    const service = (data.service as string) ?? "ground"

    this.logger_.info(
      `[Envia] Generando guía ${carrier}/${service} para orden ${order?.display_id ?? order?.id}`
    )

    const shipment = await this.client_.generate({
      origin,
      destination,
      packages,
      carrier,
      service,
    })

    return {
      data: {
        envia_shipment_id: shipment.shipmentId,
        envia_carrier: shipment.carrier,
        envia_service: shipment.service,
        envia_total_price: shipment.totalPrice,
        envia_tracking_number: shipment.trackingNumber,
      },
      labels: [
        {
          tracking_number: shipment.trackingNumber,
          tracking_url: shipment.trackUrl,
          label_url: shipment.label,
        },
      ],
    }
  }

  /**
   * Solicita recogida en la bodega de origen para uno o más tracking numbers
   * del mismo carrier — se llama desde el endpoint admin
   * POST /admin/envia/pickup, no automáticamente.
   */
  async requestPickup(params: {
    carrier: EnviaCarrier
    trackingNumbers: string[]
    pickupDate: string // "YYYY-MM-DD"
    pickupTimeStart: string // "HH:mm"
    pickupTimeEnd: string // "HH:mm"
  }) {
    const o = this.options_.origin
    return this.client_.pickup({
      carrier: params.carrier,
      pickupAddress: {
        name: o.name,
        phone: o.phone,
        street: o.street,
        city: o.city,
        state: o.state,
        country: o.country,
        postalCode: o.postalCode,
      },
      pickupDate: params.pickupDate,
      pickupTimeStart: params.pickupTimeStart,
      pickupTimeEnd: params.pickupTimeEnd,
      trackingNumbers: params.trackingNumbers,
    })
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<any> {
    const carrier = data.envia_carrier as string
    const trackingNumber = data.envia_tracking_number as string
    if (!carrier || !trackingNumber) {
      this.logger_.warn(
        "[Envia] cancelFulfillment llamado sin carrier/trackingNumber en data — nada que cancelar en Envia.com"
      )
      return
    }
    await this.client_.cancel(carrier, trackingNumber)
  }

  async getFulfillmentDocuments(): Promise<never[]> {
    return []
  }

  async retrieveDocuments(): Promise<void> {
    return undefined
  }

  // ---- helpers ----

  private buildOriginAddress(): EnviaAddress {
    const o = this.options_.origin
    return {
      name: o.name,
      phone: o.phone,
      street: o.street,
      number: process.env.ENVIA_ORIGIN_NUMBER || "S/N",
      city: o.city,
      state: o.state,
      country: o.country,
      postalCode: o.postalCode,
    }
  }

  /** Peso/dimensiones por defecto — configurables vía ENVIA_DEFAULT_* en Railway. */
  private buildDefaultPackages(): EnviaPackage[] {
    const p = this.options_.defaultPackage
    return [
      {
        type: "box",
        content: "Equipo ecuestre / airbag Hit-Air",
        amount: 1,
        declaredValue: p.declaredValue,
        lengthUnit: "CM",
        weightUnit: "KG",
        weight: p.weightKg,
        dimensions: { length: p.lengthCm, width: p.widthCm, height: p.heightCm },
      },
    ]
  }

  private async inferCarrierFromShippingMethod(
    order: Partial<FulfillmentOrderDTO> | undefined,
    fallbackData?: Record<string, unknown>
  ): Promise<EnviaCarrier> {
    const method = order?.shipping_methods?.[0] as any
    const shippingOptionId = method?.shipping_option_id

    // Fuente de verdad: la shipping option EN VIVO, no la foto que quedó
    // guardada en la orden al momento del checkout (puede quedar
    // desactualizada si cambiamos el carrier después, como ya nos pasó).
    if (shippingOptionId && this.query_) {
      try {
        const { data } = await this.query_.graph({
          entity: "shipping_option",
          fields: ["data"],
          filters: { id: shippingOptionId },
        })
        const liveCarrier = (data[0]?.data as Record<string, unknown> | undefined)?.id as
          | EnviaCarrier
          | undefined
        if (liveCarrier) return liveCarrier
      } catch (err) {
        this.logger_.warn(
          `[Envia] No se pudo leer la shipping option en vivo (${shippingOptionId}), usando snapshot`
        )
      }
    }

    const snapshotCarrier =
      ((method?.data as Record<string, unknown> | undefined)?.id as EnviaCarrier | undefined) ??
      (fallbackData?.id as EnviaCarrier | undefined)
    return snapshotCarrier ?? ((process.env.ENVIA_DEFAULT_CARRIER as EnviaCarrier) || "interrapidisimo")
  }
}

export default EnviaFulfillmentProviderService
