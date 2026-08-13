import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { IPaymentModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paymentService: IPaymentModuleService = req.scope.resolve(Modules.PAYMENT)

  try {
    await paymentService.processEvent({
      provider: "pp_wompi",
      payload: {
        data: req.body as Record<string, unknown>,
        rawData: (req as any).rawBody ?? JSON.stringify(req.body),
        headers: req.headers as Record<string, unknown>,
      },
    })
    res.sendStatus(200)
  } catch (err: any) {
    console.error("[WOMPI webhook] error procesando evento:", err?.message)
    // Retornar 200 para evitar que Wompi reintente indefinidamente
    res.sendStatus(200)
  }
}

