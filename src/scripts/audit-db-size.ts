/**
 * src/scripts/audit-db-size.ts
 *
 * Muestra que esta ocupando el volumen de Postgres.
 *
 * El volumen es compartido por las dos bases del servidor: `railway` (Medusa)
 * y `nocodb` (el ERP). Este script reporta el tamano de cada base, las tablas
 * mas grandes de la base actual y el espacio que ocupan los WAL.
 *
 * Solo lectura.
 *
 * Uso, desde /app en el contenedor de Railway:
 *   npx medusa exec ./src/scripts/audit-db-size.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function auditDbSize({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const manager: any = container.resolve(ContainerRegistrationKeys.MANAGER)
  const knex = manager.getKnex ? manager.getKnex() : manager.connection

  const sql = async (q: string) => {
    const res = await knex.raw(q)
    return res?.rows ?? res
  }

  logger.info("")
  logger.info("=== TAMANO DE CADA BASE ===")
  const bases = await sql(`
    SELECT datname,
           pg_size_pretty(pg_database_size(datname)) AS tamano,
           pg_database_size(datname) AS bytes
    FROM pg_database
    WHERE datistemplate = false
    ORDER BY pg_database_size(datname) DESC
  `)
  let total = 0
  for (const b of bases) {
    total += Number(b.bytes)
    logger.info(`  ${String(b.datname).padEnd(22)} ${b.tamano}`)
  }
  logger.info(`  ${"TOTAL".padEnd(22)} ${(total / 1024 / 1024).toFixed(1)} MB`)

  logger.info("")
  logger.info("=== WAL (registro de transacciones) ===")
  try {
    const wal = await sql(`
      SELECT count(*) AS archivos,
             pg_size_pretty(sum(size)) AS tamano
      FROM pg_ls_waldir()
    `)
    logger.info(`  ${wal[0].archivos} archivos, ${wal[0].tamano}`)
    const cfg = await sql(`
      SELECT name, setting, unit FROM pg_settings
      WHERE name IN ('max_wal_size','min_wal_size','wal_keep_size','max_slot_wal_keep_size')
    `)
    for (const c of cfg) {
      logger.info(`  ${String(c.name).padEnd(24)} ${c.setting} ${c.unit || ""}`)
    }
  } catch (e: any) {
    logger.warn(`  no se pudo leer el WAL: ${e?.message}`)
  }

  logger.info("")
  logger.info("=== TABLAS MAS GRANDES DE LA BASE ACTUAL (Medusa) ===")
  const tablas = await sql(`
    SELECT schemaname || '.' || relname AS tabla,
           pg_size_pretty(pg_total_relation_size(relid)) AS total,
           n_live_tup AS filas
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 20
  `)
  for (const t of tablas) {
    logger.info(`  ${String(t.tabla).padEnd(46)} ${String(t.total).padStart(10)}  ${t.filas} filas`)
  }

  logger.info("")
  logger.info("=== ESPACIO RECUPERABLE (filas muertas sin VACUUM) ===")
  const muertas = await sql(`
    SELECT schemaname || '.' || relname AS tabla,
           n_dead_tup AS muertas,
           last_autovacuum
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 1000
    ORDER BY n_dead_tup DESC
    LIMIT 10
  `)
  if (!muertas.length) {
    logger.info("  nada relevante")
  }
  for (const m of muertas) {
    logger.info(`  ${String(m.tabla).padEnd(46)} ${m.muertas} filas muertas`)
  }

  logger.info("")
  logger.info(
    "Nota: la base `nocodb` no se puede inspeccionar desde aqui por diseno " +
      "(su usuario no tiene acceso a `railway` y viceversa)."
  )
}
