import { defineMiddlewares } from "@medusajs/framework/http"

/**
 * El webhook de Wompi llegaba con error 413 (request entity too large)
 * porque el limite por defecto del body es muy bajo para su payload.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/hooks/payment/*",
      bodyParser: { sizeLimit: "5mb", preserveRawBody: true },
    },
  ],
})
