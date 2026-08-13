import { AbstractPaymentProvider, ModuleProvider, Modules } from "@medusajs/framework/utils"
import { PaymentSessionStatus } from "@medusajs/framework/utils"
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

  private wompiApiBase(): string {
    const env = (this.options_.env || process.env.WOMPI_ENV || "test").toLowerCase()
    return env === "prod" || env === "production"
      ? "https://production.wompi.co"
      : "https://sandbox.wompi.co"
  }

  private privateKey(): string {
    return (this.options_.privateKey || process.env.WOMPI_PRIVATE_KEY || "").trim()
  }

  /**
   * Consulta el estado real de una transacción en Wompi.
   * Retorna el objeto transaction de Wompi o null si no existe / hay error.
   */
  private async fetchWompiTransaction(txId: string): Promise<any | null> {
    try {
      const res = await fetch(
        `${this.wompiApiBase()}/v1/transactions/${txId}`,
        { headers: { Authorization: `Bearer ${this.privateKey()}` } }
      )
      if (!res.ok) {
        console.log("[WOMPI] fetchWompiTransaction HTTP", res.status, "para tx", txId)
        return null
      }
      const json: any = await res.json()
      return json?.data ?? null
    } catch (e: any) {
      console.log("[WOMPI] fetchWompiTransaction error:", e?.message)
      return null
    }
  }

  /**
   * Busca la primera transacción APPROVED cuya referencia empiece por `prefix`.
   */
  private async findApprovedByReference(prefix: string): Promise<any | null> {
    try {
      const res = await fetch(
        `${this.wompiApiBase()}/v1/transactions?page[size]=50`,
        { headers: { Authorization: `Bearer ${this.privateKey()}` } }
      )
      if (!res.ok) return null
      const json: any = await res.json()
      const todas: any[] = json?.data || []
      return todas.find(
        (t) =>
          String(t?.reference || "").startsWith(prefix) &&
          t?.status === "APPROVED"
      ) ?? null
    } catch (e: any) {
      console.log("[WOMPI] findApprovedByReference error:", e?.message)
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // initiatePayment
  // ---------------------------------------------------------------------------
  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    console.log("[WOMPI initiatePayment] input.data:", JSON.stringify(input.data || {}))

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
  // authorizePayment — consulta real a la API de Wompi
  // ---------------------------------------------------------------------------
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = (input.data || {}) as Record<string, any>
    console.log("[WOMPI authorizePayment] data recibida:", JSON.stringify(data))

    // 1) Ya tenemos transaction_id → consultar directamente
    const txId = data.transaction_id as string | undefined
    if (txId) {
      const tx = await this.fetchWompiTransaction(txId)
      console.log("[WOMPI authorizePayment] tx remota:", JSON.stringify(tx))

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
      // PENDING u otro → pendiente
      return {
        status: PaymentSessionStatus.PENDING,
        data: { ...data, wompi_status: tx?.status ?? "PENDING" },
      }
    }

    // 2) Sin transaction_id → buscar por referencia usando session_id / idempotency_key
    const prefix =
      (data.session_id as string | undefined) ||
      ((input.context as any)?.idempotency_key as string | undefined)

    if (prefix) {
      console.log("[WOMPI authorizePayment] buscando por prefijo:", prefix)
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

    // 3) No hay suficiente información → PENDING
    console.log("[WOMPI authorizePayment] sin transaction_id ni referencia aprobada → PENDING")
    return {
      status: PaymentSessionStatus.PENDING,
      data: { ...data, wompi_status: "PENDING" },
    }
  }

  // ---------------------------------------------------------------------------
  // getPaymentStatus — refleja el estado almacenado en la sesión
  // ---------------------------------------------------------------------------
  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const txId = input.data?.transaction_id as string | undefined
    const cached = input.data?.wompi_status as string | undefined

    // Si tenemos transaction_id, consultar en tiempo real para obtener estado fresco
    if (txId) {
      const tx = await this.fetchWompiTransaction(txId)
      if (tx) {
        const statusMap: Record<string, PaymentSessionStatus> = {
          APPROVED: PaymentSessionStatus.AUTHORIZED,
          DECLINED: PaymentSessionStatus.ERROR,
          VOIDED: PaymentSessionStatus.CANCELED,
          ERROR: PaymentSessionStatus.ERROR,
          PENDING: PaymentSessionStatus.PENDING,
        }
        return { status: statusMap[tx.status] ?? PaymentSessionStatus.PENDING }
      }
    }

    // Fallback al estado cacheado en la sesión
    const statusMap: Record<string, PaymentSessionStatus> = {
      APPROVED: PaymentSessionStatus.AUTHORIZED,
      DECLINED: PaymentSessionStatus.ERROR,
      VOIDED: PaymentSessionStatus.CANCELED,
      ERROR: PaymentSessionStatus.ERROR,
    }
    return { status: statusMap[cached ?? ""] ?? PaymentSessionStatus.PENDING }
  }

  // ---------------------------------------------------------------------------
  // Resto de métodos requeridos por la interfaz
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Webhook
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
      console.log(
        "[WOMPI webhook] tx:", transaction.id,
        "status:", transaction.status,
        "ref:", transaction.reference
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

