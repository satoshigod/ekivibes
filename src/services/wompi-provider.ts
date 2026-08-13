import { AbstractPaymentProvider, ModuleProvider, Modules } from "@medusajs/framework/utils"
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
    console.log("[WOMPI initiatePayment] input.data recibido:",
      JSON.stringify(input.data || {}))

    return {
      id: `wompi-${Date.now()}`,
      data: {
        ...((input.data as Record<string, unknown>) || {}),
        amount: input.amount,
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

    if (data.wompi_status === "APPROVED") {
      return { status: "authorized" as any, data }
    }

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

    const sessionId =
      data.session_id ||
      (input.context as any)?.idempotency_key ||
      (input.data as any)?.session_id
    const cartId = sessionId
    if (cartId && this.options_.privateKey) {
      try {
        const url = `${this.wompiApiBase()}/v1/transactions?page[size]=50`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.options_.privateKey}` },
        })
        const json: any = await res.json()
        const todas: any[] = json?.data || []
        const txs = todas.filter((t) =>
          String(t?.reference || "").startsWith(String(cartId))
        )
        console.log(
          "[WOMPI authorizePayment] total recientes:",
          todas.length,
          "| refs:",
          JSON.stringify(todas.slice(0, 5).map((t) => t?.reference))
        )
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

  private extractCartId(reference?: string): string | undefined {
    if (!reference) return undefined
    const match = reference.match(/^(cart_[A-Za-z0-9]+)_/)
    if (match) return match[1]
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
      console.log(
        "[WOMPI webhook] tx:",
        transaction.id,
        "status:",
        transaction.status,
        "ref:",
        transaction.reference
      )

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

export default ModuleProvider(Modules.PAYMENT, {
  services: [WompiPaymentProviderService],
})

