import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import { Logger } from "@medusajs/framework/types"
import { Resend } from "resend"
import { orderPlacedHtml } from "./templates/order-placed"
import { orderStatusHtml } from "./templates/order-status"
import {
  businessRegistrationAdminHtml,
  businessRegistrationConfirmationHtml,
} from "./templates/business-registration"

type ResendOptions = {
  api_key: string
  from: string
}

enum Templates {
  ORDER_PLACED = "order-placed",
  ORDER_FULFILLED = "order-fulfilled",
  ORDER_SHIPPED = "order-shipped",
  ORDER_DELIVERED = "order-delivered",
  BUSINESS_REGISTRATION_ADMIN = "business-registration-admin",
  BUSINESS_REGISTRATION_CONFIRMATION = "business-registration-confirmation",
}

const templates: Record<string, (data: any) => string> = {
  [Templates.ORDER_PLACED]: orderPlacedHtml,
  [Templates.ORDER_FULFILLED]: (data: any) => orderStatusHtml({ ...data, stage: "fulfilled" }),
  [Templates.ORDER_SHIPPED]: (data: any) => orderStatusHtml({ ...data, stage: "shipped" }),
  [Templates.ORDER_DELIVERED]: (data: any) => orderStatusHtml({ ...data, stage: "delivered" }),
  [Templates.BUSINESS_REGISTRATION_ADMIN]: businessRegistrationAdminHtml,
  [Templates.BUSINESS_REGISTRATION_CONFIRMATION]: businessRegistrationConfirmationHtml,
}

const subjectBuilders: Record<string, (data: any) => string> = {
  [Templates.ORDER_PLACED]: (data: any) =>
    `Confirmación de tu pedido #${data?.order?.display_id ?? ""} - Ekivibes`,
  [Templates.ORDER_FULFILLED]: (data: any) =>
    `Tu pedido #${data?.order?.display_id ?? ""} está siendo preparado - Ekivibes`,
  [Templates.ORDER_SHIPPED]: (data: any) =>
    `Tu pedido #${data?.order?.display_id ?? ""} va en camino - Ekivibes`,
  [Templates.ORDER_DELIVERED]: (data: any) =>
    `Tu pedido #${data?.order?.display_id ?? ""} fue entregado - Ekivibes`,
  [Templates.BUSINESS_REGISTRATION_ADMIN]: (data: any) =>
    `${data?.requestType === "distribuidor" ? "Nueva solicitud de distribuidor" : "Nueva solicitud empresarial"} (${
      data?.store === "hitair-colombia" ? "Hit-Air Colombia" : "Ekivibes"
    }) - ${data?.companyName || data?.contactName || ""}`,
  [Templates.BUSINESS_REGISTRATION_CONFIRMATION]: (data: any) =>
    `Recibimos tu solicitud - ${
      data?.store === "hitair-colombia" ? "Hit-Air Colombia" : "Ekivibes"
    }`,
}

type InjectedDependencies = { logger: Logger }

class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "notification-resend"
  private resendClient: Resend
  private options: ResendOptions
  private logger: Logger

  constructor({ logger }: InjectedDependencies, options: ResendOptions) {
    super()
    this.resendClient = new Resend(options.api_key)
    this.options = options
    this.logger = logger
  }

  static validateOptions(options: Record<any, any>) {
    if (!options.api_key) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "`api_key` es requerido")
    }
    if (!options.from) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "`from` es requerido")
    }
  }

  async send(notification: any) {
    const templateFn = templates[notification.template]
    if (!templateFn) {
      this.logger.error(`No existe template para ${notification.template}`)
      return {}
    }

    const html = templateFn(notification.data)
    const subjectFn = subjectBuilders[notification.template]
    const subject = subjectFn ? subjectFn(notification.data) : "Ekivibes"

    const { data, error } = await this.resendClient.emails.send({
      from: this.options.from,
      to: [notification.to],
      subject,
      html,
    })

    if (error || !data) {
      this.logger.error("Error enviando email con Resend", error as any)
      return {}
    }

    return { id: data.id }
  }
}

export default ResendNotificationProviderService
