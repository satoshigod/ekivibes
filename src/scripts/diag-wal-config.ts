/**
 * src/scripts/diag-wal-config.ts
 *
 * Averigua por que ALTER SYSTEM no cambio max_wal_size.
 *
 * El script anterior ejecuto ALTER SYSTEM sin error, pero el valor siguio en
 * 1024 MB con origen "configuration file". Normalmente postgresql.auto.conf
 * (donde escribe ALTER SYSTEM) se lee de ultimo y gana. Aqui no gano, asi
 * que hay que ver que archivo lo esta fijando y si el ALTER llego a escribir.
 *
 * Solo lectura.
 *
 * Uso, en el servicio `ekivibes`, desde /app:
 *   npx medusa exec ./src/scripts/diag-wal-config.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function diagWalConfig({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const sql = async (q: string) => {
    const res = await knex.raw(q)
    return res?.rows ?? res
  }

  logger.info("")
  logger.info("=== QUE ARCHIVO FIJA CADA PARAMETRO ===")
  const s = await sql(`
    SELECT name, setting, unit, source, sourcefile, sourceline, pending_restart
    FROM pg_settings
    WHERE name IN ('max_wal_size','min_wal_size')
    ORDER BY name
  `)
  for (const c of s) {
    logger.info(`  ${c.name}`)
    logger.info(`     valor     : ${c.setting} ${c.unit || ""}`)
    logger.info(`     origen    : ${c.source}`)
    logger.info(`     archivo   : ${c.sourcefile || "(ninguno)"} linea ${c.sourceline ?? "-"}`)
    logger.info(`     necesita reinicio: ${c.pending_restart}`)
  }

  logger.info("")
  logger.info("=== postgresql.auto.conf (lo que escribe ALTER SYSTEM) ===")
  try {
    const auto = await sql(`SELECT pg_read_file('postgresql.auto.conf') AS c`)
    const txt = String(auto[0].c || "").trim()
    logger.info(txt ? txt : "  (vacio)")
  } catch (e: any) {
    logger.warn(`  no se pudo leer: ${e?.message}`)
  }

  logger.info("")
  logger.info("=== lineas de wal en postgresql.conf ===")
  try {
    const conf = await sql(`SELECT pg_read_file('postgresql.conf') AS c`)
    const lineas = String(conf[0].c || "").split("\n")
    let n = 0
    lineas.forEach((l, i) => {
      if (/wal_size|include/i.test(l) && !l.trim().startsWith("#")) {
        logger.info(`  linea ${i + 1}: ${l.trim()}`)
        n++
      }
    })
    if (!n) logger.info("  ninguna linea activa de wal_size ni include")
  } catch (e: any) {
    logger.warn(`  no se pudo leer: ${e?.message}`)
  }

  logger.info("")
  logger.info("=== ARCHIVOS DE CONFIGURACION EN USO ===")
  const files = await sql(`
    SELECT name, setting FROM pg_settings
    WHERE name IN ('config_file','hba_file','data_directory')
    ORDER BY name
  `)
  for (const f of files) {
    logger.info(`  ${String(f.name).padEnd(16)} ${f.setting}`)
  }
}
