/**
 * Tu checkout guarda `province` como el NOMBRE completo del departamento
 * (ej. "Antioquia"), no como código ISO 3166-2 — corregido tras ver el error
 * real en producción: "No hay mapeo Envia.com para la provincia Antioquia".
 *
 * Los códigos de abajo son un punto de partida razonable (abreviaturas
 * estilo placa/DANE) pero NO están verificados contra el catálogo real de
 * Envia.com. Corre `npx medusa exec ./src/scripts/list-envia-co-states.ts`
 * para traer la lista oficial desde la Queries API y reemplazar esto por
 * los valores reales — especialmente antes de ir a producción con
 * departamentos fuera de los más comunes (Antioquia, Cundinamarca, Valle).
 */
const RAW_MAP: Record<string, string> = {
  "amazonas": "AMA",
  "antioquia": "ANT",
  "arauca": "ARA",
  "atlantico": "ATL",
  "bogota": "DC",
  "bogota dc": "DC",
  "bogota d.c.": "DC",
  "bolivar": "BOL",
  "boyaca": "BOY",
  "caldas": "CAL",
  "caqueta": "CAQ",
  "casanare": "CAS",
  "cauca": "CAU",
  "cesar": "CES",
  "choco": "CHO",
  "cordoba": "COR",
  "cundinamarca": "CUN",
  "guainia": "GUA",
  "guaviare": "GUV",
  "huila": "HUI",
  "la guajira": "LAG",
  "guajira": "LAG",
  "magdalena": "MAG",
  "meta": "MET",
  "narino": "NAR",
  "norte de santander": "NSA",
  "putumayo": "PUT",
  "quindio": "QUI",
  "risaralda": "RIS",
  "san andres y providencia": "SAP",
  "santander": "SAN",
  "sucre": "SUC",
  "tolima": "TOL",
  "valle del cauca": "VAL",
  "vaupes": "VAU",
  "vichada": "VID",
}

/** minúsculas + sin tildes/diacríticos, para que "Bogotá" y "bogota" empaten */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

const NORMALIZED_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_MAP).map(([k, v]) => [normalize(k), v])
)

export function resolveEnviaState(medusaProvince: string | null | undefined): string {
  if (!medusaProvince) {
    throw new Error(
      "La dirección no tiene 'province' — requerido para generar la guía con Envia.com"
    )
  }
  // Soporta tanto nombre completo ("Antioquia") como código ISO viejo ("co-ant")
  const key = normalize(medusaProvince).replace(/^co-/, "")
  const mapped = NORMALIZED_MAP[key]
  if (!mapped) {
    throw new Error(
      `No hay mapeo Envia.com para la provincia "${medusaProvince}" (normalizado: "${key}"). ` +
        `Corre npx medusa exec ./src/scripts/list-envia-co-states.ts para ver el catálogo real y agrégalo aquí.`
    )
  }
  return mapped
}
