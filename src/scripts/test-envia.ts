/**
 * src/scripts/test-envia.ts
 *
 * Prueba el flujo real contra el sandbox de Envia.com SIN pasar por un
 * carrito/orden real de Medusa. Dos fases:
 *
 *  1) Siempre: pide tarifas (/ship/rate/) a los 3 carriers para descubrir
 *     los valores exactos de "service" que acepta cada uno en esta ruta
 *     (Medellín -> Bogotá). No genera ninguna guía, es de solo lectura.
 *
 *  2) Solo si GENERATE=true: compra una guía real de prueba en sandbox con
 *     Servientrega (usando el primer "service" que haya devuelto el rate),
 *     igual que hará createFulfillment() cuando marques una orden como
 *     cumplida. Esto SÍ crea un shipment de prueba visible en tu dashboard
 *     de Envia.com (sección Envíos).
 *
 * EJECUCIÓN:
 *   npx medusa exec ./src/scripts/test-envia.ts
 *   GENERATE=true npx medusa exec ./src/scripts/test-envia.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { EnviaClient, EnviaCarrier } from "../modules/envia-fulfillment/envia-client"

const CARRIERS: EnviaCarrier[] = ["servientrega", "coordinadora", "interrapidisimo"]

export default async function testEnvia({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const log = (msg: string) => logger.info(msg)

  const GENERATE = process.env.GENERATE === "true"

  const requiredEnv = [
    "ENVIA_API_TOKEN",
    "ENVIA_ORIGIN_NAME",
    "ENVIA_ORIGIN_PHONE",
    "ENVIA_ORIGIN_STREET",
    "ENVIA_ORIGIN_CITY",
    "ENVIA_ORIGIN_STATE",
    "ENVIA_ORIGIN_POSTAL_CODE",
  ]
  const missing = requiredEnv.filter((k) => !process.env[k])
  if (missing.length) {
    log(`❌ Faltan variables de entorno: ${missing.join(", ")}`)
    return
  }

  const client = new EnviaClient({
    apiToken: (process.env.ENVIA_API_TOKEN || "").trim(),
    shippingBase:
      (process.env.ENVIA_ENV || "sandbox").trim() === "production"
        ? "https://api.envia.com"
        : "https://api-test.envia.com",
    queriesBase:
      (process.env.ENVIA_ENV || "sandbox").trim() === "production"
        ? "https://queries.envia.com"
        : "https://queries-test.envia.com",
  })

  const origin = {
    name: process.env.ENVIA_ORIGIN_NAME!,
    phone: process.env.ENVIA_ORIGIN_PHONE!,
    street: process.env.ENVIA_ORIGIN_STREET!,
    city: process.env.ENVIA_ORIGIN_CITY!,
    state: process.env.ENVIA_ORIGIN_STATE!,
    country: process.env.ENVIA_ORIGIN_COUNTRY || "CO",
    postalCode: process.env.ENVIA_ORIGIN_POSTAL_CODE!,
  }

  // Destino de prueba fijo (Bogotá) — no depende de ninguna orden real.
  const destination = {
    name: "Cliente Prueba Ekivibes",
    phone: "+573001234567",
    street: "Calle 100 #15-20",
    city: "Bogota",
    state: "DC",
    country: "CO",
    postalCode: "110111",
  }

  const packages = [
    {
      type: "box" as const,
      content: "Chaleco airbag Hit-Air",
      amount: 1,
      declaredValue: Number(process.env.ENVIA_DEFAULT_DECLARED_VALUE || "150000"),
      lengthUnit: "CM" as const,
      weightUnit: "KG" as const,
      weight: Number(process.env.ENVIA_DEFAULT_WEIGHT_KG || "1.5"),
      dimensions: {
        length: Number(process.env.ENVIA_DEFAULT_LENGTH_CM || "30"),
        width: Number(process.env.ENVIA_DEFAULT_WIDTH_CM || "25"),
        height: Number(process.env.ENVIA_DEFAULT_HEIGHT_CM || "15"),
      },
    },
  ]

  log("=".repeat(70))
  log("FASE 1: cotizando (solo lectura) para descubrir 'service' válidos")
  log("=".repeat(70))

  const firstServiceByCarrier: Record<string, string> = {}

  for (const carrier of CARRIERS) {
    try {
      const rates = await client.rate({ origin, destination, packages, carrier })
      if (!rates.length) {
        log(`  ${carrier}: sin tarifas para esta ruta (puede no operar Medellín->Bogotá en sandbox)`)
        continue
      }
      firstServiceByCarrier[carrier] = rates[0].service
      for (const r of rates) {
        log(
          `  ${carrier} · service="${r.service}" · ${r.serviceDescription ?? ""} · ` +
            `$${r.totalPrice} ${r.currency} · ${r.deliveryEstimate ?? "sin estimado"}`
        )
      }
    } catch (err: any) {
      log(`  ❌ ${carrier}: ${err.message}`)
    }
  }

  if (!GENERATE) {
    log("\n[GENERATE=false] No se compró ninguna guía. Revisa los 'service' de arriba.")
    log("Para probar la generación real: GENERATE=true npx medusa exec ./src/scripts/test-envia.ts")
    return
  }

  log("\n" + "=".repeat(70))
  log("FASE 2: comprando guía real de prueba con Servientrega")
  log("=".repeat(70))

  const service = firstServiceByCarrier["servientrega"]
  if (!service) {
    log("❌ No hay 'service' de Servientrega disponible (revisa la Fase 1). Abortando.")
    return
  }

  try {
    const shipment = await client.generate({
      origin,
      destination,
      packages,
      carrier: "servientrega",
      service,
    })
    log(`✅ Guía generada:`)
    log(`   tracking: ${shipment.trackingNumber}`)
    log(`   tracking URL: ${shipment.trackUrl}`)
    log(`   label PDF: ${shipment.label}`)
    log(`   precio: $${shipment.totalPrice} ${shipment.currency}`)
    log(`\nBúscalo en tu dashboard de Envia.com (sandbox) en la sección Envíos.`)
  } catch (err: any) {
    log(`❌ Error generando la guía: ${err.message}`)
  }

  log("\n" + "=".repeat(70))
}
