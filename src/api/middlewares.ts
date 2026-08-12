import { defineMiddlewares } from "@medusajs/framework/http"

/**
 * El webhook de Wompi llegaba con "413 request entity too large".
 * El matcher con comodin no aplicaba, hay que declarar la ruta exacta
 * y tambien el metodo POST.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/hooks/payment/wompi_wompi",
      method: "POST",
      bodyParser: { sizeLimit: "10mb", preserveRawBody: true },
    },
    {
      matcher: "/hooks/payment/wompi",
      method: "POST",
      bodyParser: { sizeLimit: "10mb", preserveRawBody: true },
    },
    {
      matcher: "/hooks/*",
      bodyParser: { sizeLimit: "10mb", preserveRawBody: true },
    },
  ],
})
