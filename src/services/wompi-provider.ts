import { AbstractPaymentProvider } from "@medusajs/framework/utils"
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

export default class WompiPaymentProviderService extends AbstractPaymentProvider<WompiOptions> {
  static identifier = "wompi"

  protected options_: WompiOptions

  constructor(container: any, options: WompiOptions) {
    super(container, options)
    this.options_ = options
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    return {
      id: "wompi-session",
      data: {
        amount: input.amount,
        currency_code: input.currency_code,
        public_key: this.options_.publicKey || process.env.WOMPI_PUBLIC_KEY,
        env: this.options_.env || process.env.WOMPI_ENV || "test",
      },
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    return {
      status: "authorized",
      data: input.data || {},
    }
  }

  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    return {
      data: input.data || {},
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    return {
      data: input.data || {},
    }
  }

  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    return {
      data: input.data || {},
    }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const status = (input.data?.status as string) || "pending"
    return {
      status: status as any,
    }
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    return {
      data: input.data || {},
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return {
      data: input.data || {},
    }
  }

  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    return {
      data: input.data || {},
    }
  }

  async getWebhookActionAndData(
    data: {
      data: Record<string, unknown>
      rawData: string | Buffer
      headers: Record<string, unknown>
    }
  ): Promise<WebhookActionResult> {
    return {
      action: "not_supported",
    }
  }
}
