import { defineMiddlewares } from "@medusajs/framework/http"

/**
 * El webhook de Wompi llega con "413 request entity too large" cuando el
 * pago es por Bancolombia QR: Wompi incluye la imagen del QR en base64
 * dentro del payload.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/hooks/payment/wompi",
      bodyParser: { sizeLimit: "20mb", preserveRawBody: true },
    },
  ],
})
