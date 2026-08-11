import { AbstractPaymentProvider } from "@medusajs/framework/utils"
import { 
  PaymentProviderContext, 
  PaymentProviderError, 
  PaymentProviderSessionResponse 
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
    context: PaymentProviderContext
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const { amount, currency_code } = context

    return {
      data: {
        amount,
        currency_code,
        public_key: process.env.WOMPI_PUBLIC_KEY,
        env: process.env.WOMPI_ENV || "test",
      },
    }
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<PaymentProviderError | { status: string; data: Record<string, unknown> }> {
    return {
      status: "authorized",
      data: paymentSessionData,
    }
  }

  async capturePayment(
    paymentData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    return paymentData
  }

  async cancelPayment(
    paymentData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    return paymentData
  }

  async refundPayment(
    paymentData: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    return paymentData
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<string> {
    return (paymentSessionData.status as string) || "pending"
  }
}
