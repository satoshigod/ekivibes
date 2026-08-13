import { AbstractPaymentProvider, ModuleProvider, Modules, PaymentSessionStatus } from "@medusajs/framework/utils"
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
  // Debe coincidir con id: "wompi" en medusa-config.ts
  // Medusa lo registra en Awilix como pp_wompi automáticamente
  static identifier = "wompi"

  protected options_: WompiOptions

  constructor(container: any, options: WompiOptions) {
    super(container, options)
    this.options_ = options
  }

  private wompiApiBase(): string {
    const env = (this.options_.env || process.env.WOMPI_ENV || "test").toLowerCase()
    return env === "prod" || env === "production"
      ? "https://production.wompi.co"
      : "https://sandbox.wompi.co"
  }

  private privateKey(): string {
    return (this.options_.privateKey || process.env.WOMPI_PRIVATE_KEY || "").trim()
  }

  private async fetchWompiTransaction(txId: string): Promise<any | null> {
    try {
      const res = await fetch(
        `${this.wompiApiBase()}/v1/transactions/${txId}`,
        { headers: { Authorization: `Bearer ${this.privateKey()}` } }
      )
      if (!res.ok) {
        console.log("[WOMPI] fetchTransaction HTTP", res.status, "tx:", txId)
        return null
      }
      const json: any = await res.json()
      return json?.data ?? null
    } catch (e: any) {
      console.log("[WOMPI] fetchTransaction error:", e?.message)
      return null
    }
  }

  private async findApprovedByReference(prefix: string): Promise<any | null> {
    try {
      const res = await fetch(
        `${this.wompiApiBase()}/v1/transactions?page[size]=50`,
        { headers: { Authorization: `Bearer ${this.privateKey()}` } }
      )
      if (!res.ok) return null
      const json: any = await res.json()
      const todas: any[] = json?.data || []
      console.log(
        "[WOMPI] findApprovedByReference prefix:", prefix,
        "total:", todas.length,
        "refs:", JSON.stringify(todas.slice(0, 5).map((t) => t?.reference))
      )
      return (
        todas.find(
          (t) =>
            String(t?.reference || "").startsWith(prefix) &&
            t?.status === "APPROVED"
        ) ?? null
      )
    } catch (e: any) {
      console.log("[WOMPI] findApprovedByReference error:", e?.message)
      return null
    }
  }

  // ---------------------------------------------------------------------------
  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    console.log("[WOMPI initiatePayment] amount:", input.amount, "currency:", input.currency_code)
    return {
      id: `wompi-${Date.now()}`,
      data: {
        ...((input.data as Record<string, unknown>) || {}),
        amount: input.amount,
        currency_code: input.currency_code,
        public_key: (this.options_.publicKey || process.env.WOMPI_PUBLIC_KEY || "").trim(),
        env: (this.options_.env || process.env.WOMPI_ENV || "test").trim(),
        wompi_status: "PENDING",
      },
    }
  }

  // ---------------------------------------------------------------------------
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data || {}) as Record<string, any>
    console.log("[WOMPI authorizePayment] data:", JSON.stringify(data))

    // 1) transaction_id presente → consulta directa con auth
    const txId = data.transaction_id as string | undefined
    if (txId) {
      const tx = await this.fetchWompiTransaction(txId)
      console.log("[WOMPI authorizePayment] tx status:", tx?.status)

      if (tx?.status === "APPROVED") {
        return {
          status: PaymentSessionStatus.AUTHORIZED,
          data: { ...data, wompi_status: "APPROVED", transaction_id: tx.id, reference: tx.reference },
        }
      }
      if (tx?.status === "DECLINED" || tx?.status === "ERROR" || tx?.status === "VOIDED") {
        return {
          status: PaymentSessionStatus.ERROR,
          data: { ...data, wompi_status: tx.status },
        }
      }
      // PENDING u otro estado transitorio
      return {
        status: PaymentSessionStatus.PENDING,
        data: { ...data, wompi_status: tx?.status ?? "PENDING" },
      }
    }

    // 2) Sin transaction_id → buscar por referencia (session_id o idempotency_key)
    const prefix =
      (data.session_id as string | undefined) ||
      ((input.context as any)?.idempotency_key as string | undefined)

    if (prefix) {
      const aprobada = await this.findApprovedByReference(prefix)
      if (aprobada) {
        return {
          status: PaymentSessionStatus.AUTHORIZED,
          data: {
            ...data,
            wompi_status: "APPROVED",
            transaction_id: aprobada.id,
            reference: aprobada.reference,
          },
        }
      }
    }

    console.log("[WOMPI authorizePayment] sin transacción aprobada → PENDING")
    return {
      status: PaymentSessionStatus.PENDING,
      data: { ...data, wompi_status: data.wompi_status ?? "PENDING" },
    }
  }

  // ---------------------------------------------------------------------------
  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const txId = input.data?.transaction_id as string | undefined

    if (txId) {
      const tx = await this.fetchWompiTransaction(txId)
      if (tx) {
        const map: Record<string, PaymentSessionStatus> = {
          APPROVED: PaymentSessionStatus.AUTHORIZED,
          DECLINED: PaymentSessionStatus.ERROR,
          VOIDED: PaymentSessionStatus.CANCELED,
          ERROR: PaymentSessionStatus.ERROR,
          PENDING: PaymentSessionStatus.PENDING,
        }
        return { status: map[tx.status] ?? PaymentSessionStatus.PENDING }
      }
    }

    const cached = input.data?.wompi_status as string | undefined
    const fallback: Record<string, PaymentSessionStatus> = {
      APPROVED: PaymentSessionStatus.AUTHORIZED,
      DECLINED: PaymentSessionStatus.ERROR,
      VOIDED: PaymentSessionStatus.CANCELED,
      ERROR: PaymentSessionStatus.ERROR,
    }
    return { status: fallback[cached ?? ""] ?? PaymentSessionStatus.PENDING }
  }

  // ---------------------------------------------------------------------------
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data || {} }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data || {} }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data || {} }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    return { data: input.data || {} }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: input.data || {} }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: input.data || {} }
  }

  // ---------------------------------------------------------------------------
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
      console.log("[WOMPI webhook] tx:", transaction.id, "status:", transaction.status, "ref:", transaction.reference)

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
          data: { session_id: cartId, cart_id: cartId, reference: transaction.reference } as any,
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

