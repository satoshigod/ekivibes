type BusinessRegistrationData = {
  store: "ekivibes" | "hitair-colombia"
  companyName: string
  taxId?: string
  contactName: string
  contactRole?: string
  email: string
  phone: string
  city: string
  department?: string
  businessType: string
  estimatedVolume?: string
  message?: string
}

const STORE_META: Record<
  BusinessRegistrationData["store"],
  { label: string; color: string; supportEmail: string; url: string }
> = {
  ekivibes: {
    label: "Ekivibes",
    color: "#A8935E",
    supportEmail: "hola@ekivibes.co",
    url: "https://ekivibes-storefront-production.up.railway.app",
  },
  "hitair-colombia": {
    label: "Hit-Air Colombia",
    color: "#D62828",
    supportEmail: "hola@hitaircolombia.co",
    url: "https://hitair-colombia-storefront-production.up.railway.app",
  },
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function row(label: string, value?: string) {
  if (!value) return ""
  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:13px;width:170px;vertical-align:top;">${label}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;color:#1a1a1a;font-size:14px;">${escapeHtml(value)}</td>
    </tr>`
}

export function businessRegistrationAdminHtml(data: BusinessRegistrationData): string {
  const meta = STORE_META[data.store] || STORE_META.ekivibes

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background:#1a1a1a;padding:28px 24px;text-align:center;border-top:3px solid ${meta.color};">
      <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:2px;">${meta.label.toUpperCase()}</span>
    </div>
    <div style="padding:32px 24px 8px 24px;">
      <h1 style="color:#1a1a1a;font-size:20px;margin:0 0 8px 0;">Nueva solicitud de cliente empresarial</h1>
      <p style="color:#555;font-size:14px;line-height:1.5;margin:0;">
        ${escapeHtml(data.companyName)} quiere registrarse como cliente empresarial en ${meta.label}.
      </p>
    </div>
    <div style="padding:16px 24px 24px 24px;">
      <table style="width:100%;border-collapse:collapse;">
        ${row("Empresa / organización", data.companyName)}
        ${row("NIT / RUT", data.taxId)}
        ${row("Contacto", data.contactName)}
        ${row("Cargo", data.contactRole)}
        ${row("Correo", data.email)}
        ${row("Teléfono", data.phone)}
        ${row("Ciudad", data.city)}
        ${row("Departamento", data.department)}
        ${row("Tipo de negocio", data.businessType)}
        ${row("Volumen estimado", data.estimatedVolume)}
      </table>
      ${
        data.message
          ? `<div style="margin-top:20px;">
              <div style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Mensaje</div>
              <div style="color:#444;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(data.message)}</div>
            </div>`
          : ""
      }
      <div style="margin-top:24px;">
        <a href="mailto:${data.email}" style="display:inline-block;background:${meta.color};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:4px;">Responder por correo</a>
      </div>
    </div>
    <div style="background:#f8f8f8;padding:20px 24px;border-top:1px solid #eee;">
      <p style="color:#aaa;font-size:11px;text-align:center;margin:0;">
        Formulario de compras empresariales · ${meta.label}
      </p>
    </div>
  </div>`
}

export function businessRegistrationConfirmationHtml(data: BusinessRegistrationData): string {
  const meta = STORE_META[data.store] || STORE_META.ekivibes
  const nombre = data.contactName?.split(" ")[0] || "hola"

  return `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Recibimos tu solicitud de registro empresarial en ${meta.label}.
  </div>
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background:#1a1a1a;padding:28px 24px;text-align:center;border-top:3px solid ${meta.color};">
      <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:2px;">${meta.label.toUpperCase()}</span>
    </div>
    <div style="padding:32px 24px;">
      <h1 style="color:#1a1a1a;font-size:20px;margin:0 0 8px 0;">Recibimos tu solicitud</h1>
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 16px 0;">
        Hola ${escapeHtml(nombre)}, gracias por registrar a <strong>${escapeHtml(data.companyName)}</strong> como
        cliente empresarial de ${meta.label}. Nuestro equipo revisará tu solicitud y te contactará en
        máximo 2 días hábiles al correo o teléfono que nos compartiste.
      </p>
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0;">
        Si tu solicitud es urgente, también puedes escribirnos directamente a
        <a href="mailto:${meta.supportEmail}" style="color:${meta.color};text-decoration:none;">${meta.supportEmail}</a>.
      </p>
    </div>
    <div style="background:#f8f8f8;padding:20px 24px;border-top:1px solid #eee;">
      <p style="color:#aaa;font-size:11px;text-align:center;margin:0;">
        ${meta.label} · Este es un correo automático de confirmación
      </p>
    </div>
  </div>`
}
