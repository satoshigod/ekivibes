/**
 * src/scripts/audit-db-files.ts
 *
 * Localiza el espacio del volumen que NO son datos.
 *
 * audit-db-size mostro 50 MB de bases y 32 MB de WAL, pero el volumen
 * reporta 480 MB usados. Este script recorre el directorio de datos de
 * Postgres para encontrar la diferencia: logs, archivos de versiones
 * anteriores, temporales o WAL reciclado.
 *
 * Solo lectura.
 *
 * Uso, en el servicio `ekivibes`, desde /app:
 *   npx medusa exec ./src/scripts/audit-db-files.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function auditDbFiles({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const sql = async (q: string) => {
    const res = await knex.raw(q)
    return res?.rows ?? res
  }

  const mb = (b: any) => (Number(b) / 1024 / 1024).toFixed(1) + " MB"

  logger.info("")
  logger.info("=== DIRECTORIO DE DATOS ===")
  try {
    const dd = await sql(`SHOW data_directory`)
    logger.info(`  ${dd[0].data_directory}`)
  } catch (e: any) {
    logger.warn(`  no visible: ${e?.message}`)
  }

  logger.info("")
  logger.info("=== CARPETAS DE PRIMER NIVEL ===")
  try {
    const raiz = await sql(`
      SELECT name,
             (pg_stat_file('./' || name)).size AS size,
             (pg_stat_file('./' || name)).isdir AS isdir
      FROM pg_ls_dir('.') AS name
      ORDER BY 2 DESC
    `)
    for (const f of raiz) {
      logger.info(`  ${String(f.name).padEnd(28)} ${f.isdir ? "[dir]" : mb(f.size)}`)
    }
  } catch (e: any) {
    logger.warn(`  no se pudo leer: ${e?.message}`)
  }

  // Las carpetas grandes hay que sumarlas archivo por archivo.
  for (const dir of ["pg_wal", "log", "pg_log", "base", "pg_xact", "pg_replslot"]) {
    try {
      const r = await sql(`
        SELECT count(*) AS n, COALESCE(sum((pg_stat_file('${dir}/' || name)).size), 0) AS total
        FROM pg_ls_dir('${dir}') AS name
        WHERE (pg_stat_file('${dir}/' || name)).isdir = false
      `)
      logger.info("")
      logger.info(`=== ${dir}: ${r[0].n} archivos, ${mb(r[0].total)} ===`)
      if (Number(r[0].total) > 20 * 1024 * 1024) {
        const top = await sql(`
          SELECT name, (pg_stat_file('${dir}/' || name)).size AS size
          FROM pg_ls_dir('${dir}') AS name
          ORDER BY 2 DESC LIMIT 8
        `)
        for (const f of top) {
          logger.info(`    ${String(f.name).padEnd(34)} ${mb(f.size)}`)
        }
      }
    } catch {
      // la carpeta puede no existir en esta version
    }
  }

  logger.info("")
  logger.info("=== SLOTS DE REPLICACION (retienen WAL si estan inactivos) ===")
  try {
    const slots = await sql(`
      SELECT slot_name, active, restart_lsn,
             pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS wal_retenido
      FROM pg_replication_slots
    `)
    if (!slots.length) {
      logger.info("  ninguno")
    }
    for (const s of slots) {
      logger.warn(`  ${s.slot_name} activo=${s.active} retiene ${s.wal_retenido}`)
    }
  } catch (e: any) {
    logger.warn(`  no visible: ${e?.message}`)
  }

  logger.info("")
  logger.info("=== CONFIGURACION DE RIESGO ===")
  const cfg = await sql(`
    SELECT name, setting, unit FROM pg_settings
    WHERE name IN ('max_wal_size','min_wal_size','checkpoint_timeout',
                   'logging_collector','log_rotation_size','log_min_duration_statement')
    ORDER BY name
  `)
  for (const c of cfg) {
    logger.info(`  ${String(c.name).padEnd(28)} ${c.setting} ${c.unit || ""}`)
  }
  logger.info("")
  logger.warn(
    "max_wal_size en 1024 MB sobre un volumen de 500 MB permite que Postgres " +
      "llene el disco por si solo. Conviene bajarlo a 256 MB."
  )
}
