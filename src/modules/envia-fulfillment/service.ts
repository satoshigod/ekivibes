import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import type {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceDTO,
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
  protected options_: EnviaFulfillmentOptions
  protected client_: EnviaClient

  constructor({ logger }: InjectedDependencies, options: EnviaFulfillmentOptions) {
    super()
    this.logger_ = logger
    this.options_ = options
    this.client_ = new EnviaClient({
      apiToken: options.apiToken,
      shippingBase: options.shippingBase,
      queriesBase: options.queriesBase,
    })
  }

  /**
   * Un "fulfillment option" por carrier. El admin los usa para crear
   * shipping options en Configuraciones > Envío, con price_type "calculated".
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
        "Se requiere ciudad y departamento en la dirección de envío para cotizar con Envia.com"
      )
    }
    return data
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return CARRIERS.some((c) => c.id === (data.id as string))
  }

  /** Todas nuestras opciones son de precio calculado (tiempo real) */
  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  /**
   * Cotización en tiempo real — se llama automáticamente cuando el
   * storefront pide GET /store/shipping-options?cart_id=... para una
   * shipping option con price_type: "calculated".
   */
  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const carrier = optionData.id as EnviaCarrier
    const address = context.shipping_address

    if (!address?.city || !address?.province || !address?.postal_code) {
      throw new Error("Dirección incompleta para cotizar envío")
    }

    const origin = this.buildOriginAddress()
    const destination: EnviaAddress = {
      name: `${address.first_name ?? ""} ${address.last_name ?? ""}`.trim() || "Cliente",
      phone: address.phone ?? "",
      street: [address.address_1, address.address_2].filter(Boolean).join(" ") || "N/A",
      city: address.city,
      state: resolveEnviaState(address.province),
      country: address.country_code?.toUpperCase() ?? "CO",
      postalCode: address.postal_code,
    }

    const packages = this.buildPackages(context.items ?? [])

    const rates = await this.client_.rate({
      origin,
      destination,
      packages,
      carrier,
    })

    if (!rates.length) {
      throw new Error(`Envia.com no devolvió tarifas para ${carrier} en esta ruta`)
    }

    // La opción más barata del carrier seleccionado. Si el checkout necesita
    // mostrar varios servicios (ground/express) del mismo carrier, expón
    // varias fulfillment options (una por servicio) en vez de una por carrier.
    const cheapest = rates.reduce((min, r) =>
      parseFloat(r.totalPrice) < parseFloat(min.totalPrice) ? r : min
    )

    return {
      calculated_amount: parseFloat(cheapest.totalPrice),
      is_calculated_price_tax_inclusive: true,
    }
  }

  /**
   * Se ejecuta cuando el Admin marca la orden como "Create fulfillment".
   * Compra la guía real en Envia.com y devuelve tracking + PDF, que Medusa
   * guarda nativamente en fulfillment.labels.
   */
  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const carrier = (data.id as EnviaCarrier) ?? this.inferCarrierFromShippingMethod(order)
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
      city: address.city,
      state: resolveEnviaState(address.province),
      country: address.country_code?.toUpperCase() ?? "CO",
      postalCode: address.postal_code,
    }

    const packages = this.buildPackagesFromFulfillmentItems(items)
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
      city: o.city,
      state: o.state,
      country: o.country,
      postalCode: o.postalCode,
    }
  }

  /**
   * Construye UN package agregando peso/dimensiones de todos los items del
   * carrito. Para EKIVIBES, cada variante (VH-ADU-S/M/L, MLV-ADU-*, etc.)
   * debe tener weight/length/height/width cargados en Medusa — si faltan,
   * usa un fallback conservador para no romper el checkout, pero esto debe
   * corregirse en el catálogo antes de producción.
   */
  private buildPackages(
    items: {
      quantity: unknown // BigNumberValue en Medusa: number | string | BigNumber-like
      variant?: { weight?: number; length?: number; height?: number; width?: number }
    }[]
  ): EnviaPackage[] {
    let totalWeight = 0
    let maxLength = 20
    let maxWidth = 20
    let totalHeight = 0
    let totalValue = 0

    for (const item of items) {
      const qty = Number(item.quantity ?? 1)
      const w = item.variant?.weight ?? 1000 // gramos, fallback conservador
      totalWeight += (w / 1000) * qty // kg
      maxLength = Math.max(maxLength, item.variant?.length ?? 30)
      maxWidth = Math.max(maxWidth, item.variant?.width ?? 25)
      totalHeight += (item.variant?.height ?? 10) * qty
    }

    return [
      {
        type: "box",
        content: "Equipo ecuestre / airbag Hit-Air",
        amount: 1,
        declaredValue: Math.max(totalValue, 50000), // COP — ajustar con el valor real del carrito
        lengthUnit: "CM",
        weightUnit: "KG",
        weight: Math.max(totalWeight, 0.5),
        dimensions: { length: maxLength, width: maxWidth, height: Math.max(totalHeight, 10) },
      },
    ]
  }

  private buildPackagesFromFulfillmentItems(
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[]
  ): EnviaPackage[] {
    // FulfillmentItemDTO no siempre expande variant.weight — si tu payload
    // de creación de fulfillment no lo trae, considera resolverlo aquí vía
    // el Product Module en vez de asumir un fallback.
    let totalWeight = 0
    for (const item of items) {
      totalWeight += 0.5 * (item.quantity ?? 1) // TODO: reemplazar con peso real de variante
    }
    return [
      {
        type: "box",
        content: "Equipo ecuestre / airbag Hit-Air",
        amount: 1,
        declaredValue: 50000,
        lengthUnit: "CM",
        weightUnit: "KG",
        weight: Math.max(totalWeight, 0.5),
        dimensions: { length: 30, width: 25, height: 15 },
      },
    ]
  }

  private inferCarrierFromShippingMethod(
    order: Partial<FulfillmentOrderDTO> | undefined
  ): EnviaCarrier {
    const method = order?.shipping_methods?.[0]
    const carrier = (method?.data as Record<string, unknown> | undefined)?.id as
      | EnviaCarrier
      | undefined
    return carrier ?? "servientrega"
  }
}

export default EnviaFulfillmentProviderService
