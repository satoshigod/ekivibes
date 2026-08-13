import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { IPaymentModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paymentService: IPaymentModuleService = req.scope.resolve(Modules.PAYMENT)

  try {
    const webhookResult = await paymentService.getWebhookActionAndData({
      provider: "wompi",
      payload: {
        data: req.body as Record<string, unknown>,
        rawData: (req as any).rawBody ?? JSON.stringify(req.body),
        headers: req.headers as Record<string, unknown>,
      },
    })

    console.log("[WOMPI webhook] action:", webhookResult.action, "data:", JSON.stringify(webhookResult.data))

    if (webhookResult.action === "authorized" && webhookResult.data?.session_id) {
      await paymentService.authorizePaymentSession(
        webhookResult.data.session_id as string,
        {}
      )
    }

    res.sendStatus(200)
  } catch (err: any) {
    console.error("[WOMPI webhook] error:", err?.message)
    res.sendStatus(200)
  }
}

