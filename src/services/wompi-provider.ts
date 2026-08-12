import { AbstractPaymentProvider, ModuleProvider } from "@medusajs/framework/utils"
import {
  InitiatePaymentInput,
  InitiatePaymentOutput,
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"

type WompiOptions = {
  publicKey: string
  privateKey: string
  integritySecret: string
  env: string
}

class WompiPaymentProviderService extends AbstractPaymentProvider<WompiOptions> {
  static identifier = "wompi"

  protected options_: WompiOptions

  constructor(container: any, options: WompiOptions) {
    super(container, options)
    this.options_ = options
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    // amount de Medusa ya viene en centavos (unidad menor de la moneda)
    // Se pasa directo al widget de Wompi sin multiplicar
    console.log("[WOMPI initiatePayment] input.data recibido:",
      JSON.stringify(input.data || {}))

    return {
      id: `wompi-${Date.now()}`,
      data: {
        // Preservar lo que venga del storefront (wompi_status, transaction_id...)
        ...((input.data as Record<string, unknown>) || {}),
        amount: input.amount,           // ya en centavos — NO multiplicar x100 en el frontend
        currency_code: input.currency_code,
        public_key: this.options_.publicKey || process.env.WOMPI_PUBLIC_KEY,
        env: this.options_.env || process.env.WOMPI_ENV || "test",
      },
    }
  }

  private wompiApiBase(): string {
    const env = (this.options_.env || process.env.WOMPI_ENV || "test").toLowerCase()
    return env === "prod" || env === "production"
      ? "https://production.wompi.co"
      : "https://sandbox.wompi.co"
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = (input.data || {}) as Record<string, any>
    console.log("[WOMPI authorizePayment] data:", JSON.stringify(data))

    // 1) Estado ya confirmado (viene del widget o del webhook)
    if (data.wompi_status === "APPROVED") {
      return { status: "authorized" as any, data }
    }

    // 2) Verificar directamente con Wompi si tenemos el id de transaccion.
    //    Cubre el flujo de redirect (PSE, Nequi) donde el widget no responde.
    const txId = data.transaction_id as string | undefined
    if (txId) {
      try {
        const res = await fetch(`${this.wompiApiBase()}/v1/transactions/${txId}`)
        const json: any = await res.json()
        const status = json?.data?.status
        console.log("[WOMPI authorizePayment] consulta remota tx", txId, "->", status)
        if (status === "APPROVED") {
          return {
            status: "authorized" as any,
            data: { ...data, wompi_status: status },
          }
        }
        if (status === "DECLINED" || status === "ERROR") {
          return { status: "error" as any, data: { ...data, wompi_status: status } }
        }
      } catch (e) {
        // si falla la consulta, dejar pendiente
      }
    }

    // 3) Buscar la transaccion en Wompi por la referencia.
    //    Medusa NO pasa el cart_id al provider (el context solo trae
    //    idempotency_key), pero el session_id si esta siempre disponible
    //    y el storefront lo usa como referencia al crear la transaccion.
    const sessionId =
      data.session_id ||
      (input.context as any)?.idempotency_key ||
      (input.data as any)?.session_id
    const cartId = sessionId
    if (cartId && this.options_.privateKey) {
      try {
        const url = `${this.wompiApiBase()}/v1/transactions?reference:like=${cartId}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.options_.privateKey}` },
        })
        const json: any = await res.json()
        const txs: any[] = json?.data || []
        const aprobada = txs.find((t) => t?.status === "APPROVED")
        console.log(
          "[WOMPI authorizePayment] busqueda por carrito",
          cartId,
          "-> encontradas:",
          txs.length,
          "aprobada:",
          !!aprobada
        )
        if (aprobada) {
          return {
            status: "authorized" as any,
            data: {
              ...data,
              wompi_status: "APPROVED",
              transaction_id: aprobada.id,
              reference: aprobada.reference,
            },
          }
        }
      } catch (e: any) {
        console.log("[WOMPI authorizePayment] error buscando por carrito:", e?.message)
      }
    }

    console.log("[WOMPI authorizePayment] quedo PENDING. context:", JSON.stringify(input.context || {}))
    return { status: "pending" as any, data }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data || {} }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    // Wompi captura automáticamente al aprobar
    return { data: input.data || {} }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data || {} }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const wompiStatus = input.data?.wompi_status as string
    const statusMap: Record<string, string> = {
      APPROVED: "captured",
      DECLINED: "error",
      VOIDED: "canceled",
      ERROR: "error",
    }
    return { status: (statusMap[wompiStatus] || "pending") as any }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    return { data: input.data || {} }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: input.data || {} }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: input.data || {} }
  }

  /**
   * La referencia enviada a Wompi tiene el formato: `<cartId>_<unico>`
   * y el cartId de Medusa ya contiene guiones bajos (ej. cart_01KZ...).
   * Por eso hay que cortar en el ULTIMO "_", no en el primero.
   */
  private extractCartId(reference?: string): string | undefined {
    if (!reference) return undefined
    // Formato esperado: cart_<id>_<sufijoUnico>
    const match = reference.match(/^(cart_[A-Za-z0-9]+)_/)
    if (match) return match[1]
    // Si ya viene sin sufijo, devolver tal cual
    return reference
  }

  async getWebhookActionAndData(data: {
    data: Record<string, unknown>
    rawData: string | Buffer
    headers: Record<string, unknown>
  }): Promise<WebhookActionResult> {
    try {
      const event = data.data as any
      const transaction = event?.data?.transaction

      if (!transaction) return { action: "not_supported" }

      const cartId = this.extractCartId(transaction.reference)

      if (transaction.status === "APPROVED") {
        return {
          action: "authorized",
          data: {
            session_id: cartId,
            cart_id: cartId,
            reference: transaction.reference,
            amount: transaction.amount_in_cents,
            transaction_id: transaction.id,
          } as any,
        }
      }

      if (transaction.status === "DECLINED" || transaction.status === "ERROR") {
        return {
          action: "failed",
          data: {
            session_id: cartId,
            cart_id: cartId,
            reference: transaction.reference,
          } as any,
        }
      }
    } catch (e) {
      // malformed webhook
    }
    return { action: "not_supported" }
  }
}

export default ModuleProvider("wompi", {
  services: [WompiPaymentProviderService],
})
