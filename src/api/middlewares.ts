import { defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
  routes: [
    {
      // El webhook de Wompi puede traer QR de Bancolombia en base64 → payload grande
      matcher: "/hooks/payment/wompi",
      bodyParser: { sizeLimit: "20mb", preserveRawBody: true },
    },
  ],
})

