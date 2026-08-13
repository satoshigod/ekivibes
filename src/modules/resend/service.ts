import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import { Logger } from "@medusajs/framework/types"
import { Resend } from "resend"
import { orderPlacedHtml } from "./templates/order-placed"

type ResendOptions = {
  api_key: string
  from: string
}

enum Templates {
  ORDER_PLACED = "order-placed",
}

const templates: Record<string, (data: any) => string> = {
  [Templates.ORDER_PLACED]: orderPlacedHtml,
}

const subjects: Record<string, string> = {
  [Templates.ORDER_PLACED]: "Confirmación de tu pedido - Ekivibes",
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

    const { data, error } = await this.resendClient.emails.send({
      from: this.options.from,
      to: [notification.to],
      subject: subjects[notification.template] || "Ekivibes",
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
