import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { sendBusinessRegistrationWorkflow } from "../../../workflows/send-business-registration"

/**
 * POST /store/business-registration
 *
 * Formulario "Compras empresariales" de Ekivibes y Hit-Air Colombia (mismo
 * backend, dos storefronts). Envía una notificación al equipo de ventas y
 * una confirmación automática al solicitante, ambas vía Resend.
 */
type BusinessRegistrationBody = {
  store?: string
  requestType?: string
  companyName?: string
  taxId?: string
  contactName?: string
  contactRole?: string
  email?: string
  phone?: string
  city?: string
  department?: string
  businessType?: string
  estimatedVolume?: string
  message?: string
  website?: string // honeypot: los bots suelen rellenar campos ocultos
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, max)
}

export async function POST(req: MedusaRequest<BusinessRegistrationBody>, res: MedusaResponse) {
  const body = req.body || {}

  // Honeypot relleno => probablemente un bot. Respondemos 200 sin enviar nada.
  if (clean(body.website, 200)) {
    return res.status(200).json({ success: true })
  }

  const store = body.store === "hitair-colombia" ? "hitair-colombia" : "ekivibes"
  const requestType = body.requestType === "distribuidor" ? "distribuidor" : "empresarial"
  const companyName = clean(body.companyName, 200)
  const contactName = clean(body.contactName, 150)
  const email = clean(body.email, 200)
  const phone = clean(body.phone, 50)
  const city = clean(body.city, 100)
  const businessType = clean(body.businessType, 100)

  const missingCommon = !contactName || !email || !phone || !city
  // El formulario "empresarial" exige empresa y tipo de negocio; el de
  // "distribuidor" es más ligero, siguiendo el modelo de referencia.
  const missingForType = requestType === "empresarial" && (!companyName || !businessType)

  if (missingCommon || missingForType) {
    return res.status(400).json({
      message: "Faltan campos obligatorios: nombre, correo, teléfono y ciudad.",
    })
  }

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ message: "El correo electrónico no es válido." })
  }

  const adminEmail = process.env.BUSINESS_LEADS_EMAIL || "ivancorrea@plazablack.com"

  try {
    await sendBusinessRegistrationWorkflow(req.scope).run({
      input: {
        store,
        requestType,
        companyName: companyName || undefined,
        taxId: clean(body.taxId, 50),
        contactName,
        contactRole: clean(body.contactRole, 100),
        email,
        phone,
        city,
        department: clean(body.department, 100),
        businessType: businessType || undefined,
        estimatedVolume: clean(body.estimatedVolume, 100),
        message: clean(body.message, 2000),
        adminEmail,
      },
    })
  } catch (err: any) {
    console.error("[business-registration] error:", err?.message)
    return res.status(500).json({
      message: "No pudimos procesar tu solicitud. Intenta de nuevo o escríbenos por WhatsApp.",
    })
  }

  return res.status(200).json({ success: true })
}
