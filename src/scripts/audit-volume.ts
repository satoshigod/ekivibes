/**
 * src/scripts/audit-volume.ts
 *
 * Inspecciona el volumen completo montado en Postgres.
 *
 * Los archivos del directorio de datos suman 82 MB pero Railway reporta
 * 480 MB usados. La diferencia tiene que estar en el volumen pero fuera de
 * pgdata: restos de una version anterior, un backup, o archivos sueltos.
 *
 * El volumen se monta en /var/lib/postgresql/data y pgdata es una subcarpeta.
 *
 * Solo lectura.
 *
 * Uso, en el servicio `ekivibes`, desde /app:
 *   npx medusa exec ./src/scripts/audit-volume.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function auditVolume({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const sql = async (q: string) => {
    const res = await knex.raw(q)
    return res?.rows ?? res
  }
  const mb = (b: any) => (Number(b) / 1024 / 1024).toFixed(1) + " MB"

  const sup = await sql(`SELECT current_setting('is_superuser') AS s, current_user AS u`)
  logger.info("")
  logger.info(`usuario: ${sup[0].u}   superusuario: ${sup[0].s}`)
  if (sup[0].s !== "on") {
    logger.warn("Sin superusuario no se puede mirar fuera del directorio de datos.")
    return
  }

  const RAIZ = "/var/lib/postgresql/data"

  logger.info("")
  logger.info(`=== CONTENIDO DE ${RAIZ} ===`)
  try {
    const items = await sql(`
      SELECT name,
             (pg_stat_file('${RAIZ}/' || name)).size AS size,
             (pg_stat_file('${RAIZ}/' || name)).isdir AS isdir,
             (pg_stat_file('${RAIZ}/' || name)).modification AS modificado
      FROM pg_ls_dir('${RAIZ}') AS name
      ORDER BY 3 DESC, 2 DESC
    `)
    for (const f of items) {
      const et = f.isdir ? "[carpeta]" : mb(f.size)
      logger.info(`  ${String(f.name).padEnd(30)} ${et.padStart(12)}   ${f.modificado}`)
    }

    // Cualquier carpeta que no sea pgdata es sospechosa.
    for (const f of items) {
      if (!f.isdir || f.name === "pgdata") continue
      try {
        const r = await sql(`
          SELECT count(*) AS n,
                 COALESCE(sum((pg_stat_file('${RAIZ}/${f.name}/' || sub)).size), 0) AS total
          FROM pg_ls_dir('${RAIZ}/${f.name}') AS sub
        `)
        logger.warn(`  -> ${f.name}: ${r[0].n} elementos, ${mb(r[0].total)} (primer nivel)`)
      } catch (e: any) {
        logger.warn(`  -> ${f.name}: no se pudo leer (${e?.message})`)
      }
    }
  } catch (e: any) {
    logger.warn(`  no se pudo leer: ${e?.message}`)
  }

  // Tamano real de cada base sumando sus archivos en disco
  logger.info("")
  logger.info("=== base/ POR BASE DE DATOS ===")
  try {
    const dirs = await sql(`
      SELECT name,
             COALESCE((SELECT datname FROM pg_database WHERE oid::text = name), '(huerfano)') AS base
      FROM pg_ls_dir('base') AS name
    `)
    for (const d of dirs) {
      const r = await sql(`
        SELECT COALESCE(sum((pg_stat_file('base/${d.name}/' || sub)).size), 0) AS total
        FROM pg_ls_dir('base/${d.name}') AS sub
      `)
      const etiqueta = `${d.base} (oid ${d.name})`
      const linea = `  ${etiqueta.padEnd(34)} ${mb(r[0].total).padStart(10)}`
      if (d.base === "(huerfano)") {
        logger.warn(linea + "   <- no corresponde a ninguna base viva")
      } else {
        logger.info(linea)
      }
    }
  } catch (e: any) {
    logger.warn(`  no se pudo leer base/: ${e?.message}`)
  }

  logger.info("")
  logger.info("=== TOTAL DEL DIRECTORIO DE DATOS ===")
  try {
    const t = await sql(`
      SELECT COALESCE(sum((pg_stat_file('${RAIZ}/pgdata/' || name)).size), 0) AS total
      FROM pg_ls_dir('${RAIZ}/pgdata') AS name
    `)
    logger.info(`  archivos sueltos en pgdata: ${mb(t[0].total)}`)
  } catch (e: any) {
    logger.warn(`  ${e?.message}`)
  }
}
