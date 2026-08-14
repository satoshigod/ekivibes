/**
 * Medusa guarda el `province` de la dirección en formato ISO 3166-2 en minúsculas
 * (ej. "co-ant" para Antioquia). Envia.com espera un código de departamento en su
 * propio catálogo, que NO necesariamente coincide con ISO 3166-2.
 *
 * ⚠️ TODO antes de ir a producción: confirmar los valores reales contra
 *    GET https://queries-test.envia.com/states/CO  (Bearer $ENVIA_API_TOKEN)
 * y ajustar este mapa. Los valores de abajo son el ISO 3166-2 sin el prefijo
 * "CO-" como punto de partida razonable, pero Envia puede exigir el nombre
 * completo o un código propio — no asumir sin verificar.
 */
export const CO_PROVINCE_TO_ENVIA_STATE: Record<string, string> = {
  "co-ant": "ANT", // Antioquia
  "co-atl": "ATL", // Atlántico
  "co-bol": "BOL", // Bolívar
  "co-boy": "BOY", // Boyacá
  "co-cal": "CAL", // Caldas
  "co-cun": "CUN", // Cundinamarca
  "co-dc": "DC",   // Bogotá D.C.
  "co-val": "VAL", // Valle del Cauca
  "co-san": "SAN", // Santander
  // completar el resto de departamentos según respuesta real de la Queries API
}

export function resolveEnviaState(medusaProvince: string | null | undefined): string {
  if (!medusaProvince) {
    throw new Error(
      "La dirección no tiene 'province' — requerido para cotizar con Envia.com"
    )
  }
  const key = medusaProvince.toLowerCase()
  const mapped = CO_PROVINCE_TO_ENVIA_STATE[key]
  if (!mapped) {
    throw new Error(
      `No hay mapeo Envia.com para la provincia "${medusaProvince}". ` +
        `Verifica /states/CO en la Queries API y agrégalo a co-states-map.ts`
    )
  }
  return mapped
}
