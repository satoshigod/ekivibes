import { AbstractPaymentProvider } from "@medusajs/medusa"
import { ModuleProvider, Modules } from "@medusajs/modules-sdk"

/**
 * Wompi payment provider placeholder
 * - Follows Medusa v2.18 Payment Provider architecture
 * - Every method is intentionally not implemented yet and throws "Not implemented"
 * - TODO comments are provided for each required method
 */

@ModuleProvider(Modules.PAYMENT)
export class WompiPaymentProvider extends AbstractPaymentProvider {
  static identifier = "wompi"

  constructor(container: any, options: any) {
    // Pass through to base class
    super(container, options)
  }

  /**
   * Create a payment session / intent with the provider
   * TODO: implement creating a payment session with Wompi
   */
  async createPayment(context: any): Promise<any> {
    // TODO: implement createPayment
    throw new Error("Not implemented")
  }

  /**
   * Update an existing payment session
   * TODO: implement updatePayment
   */
  async updatePayment(context: any): Promise<any> {
    // TODO: implement updatePayment
    throw new Error("Not implemented")
  }

  /**
   * Authorize/confirm a payment (e.g., after redirect or webhook)
   * TODO: implement authorizePayment
   */
  async authorizePayment(context: any): Promise<any> {
    // TODO: implement authorizePayment
    throw new Error("Not implemented")
  }

  /**
   * Capture an authorized payment
   * TODO: implement capturePayment
   */
  async capturePayment(paymentSession: any): Promise<any> {
    // TODO: implement capturePayment
    throw new Error("Not implemented")
  }

  /**
   * Refund a payment (partial or full)
   * TODO: implement refundPayment
   */
  async refundPayment(paymentSession: any, amount: number): Promise<any> {
    // TODO: implement refundPayment
    throw new Error("Not implemented")
  }

  /**
   * Cancel a payment / void an authorization
   * TODO: implement cancelPayment
   */
  async cancelPayment(paymentSession: any): Promise<any> {
    // TODO: implement cancelPayment
    throw new Error("Not implemented")
  }

  /**
   * Return the current status of a payment/session
   * TODO: implement getStatus
   */
  async getStatus(paymentSession: any): Promise<string> {
    // TODO: implement getStatus
    throw new Error("Not implemented")
  }
}

export default WompiPaymentProvider
