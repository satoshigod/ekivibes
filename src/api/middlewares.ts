import { defineMiddlewares } from "@medusajs/framework/http"

/**
 * El webhook de Wompi llega con "413 request entity too large" cuando el
 * pago es por Bancolombia QR: Wompi incluye la imagen del QR completa en
 * base64 dentro del payload (cientos de KB).
 *
 * El matcher debe cubrir la ruta real que usa Wompi: /hooks/payment/wompi
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/hooks/payment/wompi",
      bodyParser: { sizeLimit: "20mb", preserveRawBody: true },
    },
    {
      matcher: "/hooks/payment/wompi_wompi",
      bodyParser: { sizeLimit: "20mb", preserveRawBody: true },
    },
    {
      matcher: "/hooks/**",
      bodyParser: { sizeLimit: "20mb", preserveRawBody: true },
    },
  ],
})
