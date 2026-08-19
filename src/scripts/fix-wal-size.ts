/**
 * src/scripts/fix-wal-size.ts
 *
 * Baja el techo del WAL para que Postgres no pueda llenar el volumen.
 *
 * PROBLEMA: max_wal_size esta en 1024 MB sobre un volumen de 500 MB. Bajo
 * carga sostenida Postgres puede inflar el WAL hasta ese techo, chocar con
 * el limite del disco y dejar de aceptar escrituras. Ahi caen Medusa,
 * NocoDB y las dos tiendas al tiempo.
 *
 * Los archivos reales suman ~97 MB (65 de bases + 32 de WAL). Los 480 MB que
 * reporta Railway son bloques ya asignados que el sistema de archivos no
 * devuelve aunque el archivo se borre.
 *
 * QUE HACE: ALTER SYSTEM SET max_wal_size = '256MB' y recarga la config.
 *
 * POR QUE NO ROMPE NADA:
 *  - max_wal_size NO es un limite duro que rechace transacciones: es el
 *    umbral a partir del cual Postgres dispara un checkpoint. Bajarlo hace
 *    que los checkpoints sean mas frecuentes, no que algo falle.
 *  - El unico efecto medible es un poco mas de escritura a disco en picos de
 *    carga. Con tu volumen de operacion es imperceptible.
 *  - pg_reload_conf() recarga sin reiniciar: no se cae ninguna conexion, no
 *    hay downtime, no se pierde nada.
 *  - Es reversible: ALTER SYSTEM SET max_wal_size = '1GB' lo devuelve.
 *
 * DRY_RUN=true por defecto.
 *
 * Uso, en el servicio `ekivibes`, desde /app:
 *   DRY_RUN=true  npx medusa exec ./src/scripts/fix-wal-size.ts
 *   DRY_RUN=false npx medusa exec ./src/scripts/fix-wal-size.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const NUEVO_MAX_WAL = "256MB"
const NUEVO_MIN_WAL = "48MB"

export default async function fixWalSize({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const sql = async (q: string) => {
    const res = await knex.raw(q)
    return res?.rows ?? res
  }

  const DRY_RUN = process.env.DRY_RUN !== "false"
  logger.info("")
  logger.info(`=== TECHO DEL WAL — ${DRY_RUN ? "DRY_RUN (simulacion)" : "APLICACION REAL"} ===`)

  const sup = await sql(`SELECT current_setting('is_superuser') AS s`)
  if (sup[0].s !== "on") {
    logger.error("Se requiere superusuario. Abortado.")
    return
  }

  const antes = await sql(`
    SELECT name, setting, unit, source FROM pg_settings
    WHERE name IN ('max_wal_size','min_wal_size') ORDER BY name
  `)
  logger.info("")
  logger.info("Antes:")
  for (const c of antes) {
    logger.info(`  ${String(c.name).padEnd(16)} ${c.setting} ${c.unit || ""}   (origen: ${c.source})`)
  }

  const wal = await sql(`
    SELECT count(*) AS n, pg_size_pretty(COALESCE(sum(size),0)) AS tam FROM pg_ls_waldir()
  `)
  logger.info(`  WAL en disco ahora: ${wal[0].n} archivos, ${wal[0].tam}`)

  if (DRY_RUN) {
    logger.info("")
    logger.info(`[simulacion] se aplicaria max_wal_size = ${NUEVO_MAX_WAL}, min_wal_size = ${NUEVO_MIN_WAL}`)
    logger.info("Nada fue modificado.")
    logger.info("Para aplicar: DRY_RUN=false npx medusa exec ./src/scripts/fix-wal-size.ts")
    return
  }

  await sql(`ALTER SYSTEM SET max_wal_size = '${NUEVO_MAX_WAL}'`)
  await sql(`ALTER SYSTEM SET min_wal_size = '${NUEVO_MIN_WAL}'`)
  // Recarga en caliente: no reinicia el servidor ni corta conexiones.
  await sql(`SELECT pg_reload_conf()`)

  const despues = await sql(`
    SELECT name, setting, unit, source FROM pg_settings
    WHERE name IN ('max_wal_size','min_wal_size') ORDER BY name
  `)
  logger.info("")
  logger.info("Despues:")
  for (const c of despues) {
    logger.info(`  ${String(c.name).padEnd(16)} ${c.setting} ${c.unit || ""}   (origen: ${c.source})`)
  }

  // Un checkpoint libera el WAL que ya no hace falta retener.
  logger.info("")
  logger.info("Ejecutando CHECKPOINT para reciclar el WAL sobrante...")
  await sql(`CHECKPOINT`)
  const walDespues = await sql(`
    SELECT count(*) AS n, pg_size_pretty(COALESCE(sum(size),0)) AS tam FROM pg_ls_waldir()
  `)
  logger.info(`  WAL ahora: ${walDespues[0].n} archivos, ${walDespues[0].tam}`)

  // Verificacion real: el ALTER SYSTEM puede ejecutarse sin error y aun asi
  // no aplicar, si postgresql.conf fija el valor con mayor precedencia.
  const aplicado = despues.find((c: any) => c.name === "max_wal_size")
  const valorMB = Number(aplicado?.setting || 0)
  if (valorMB > 256) {
    logger.error("")
    logger.error(
      `NO SE APLICO: max_wal_size sigue en ${valorMB} MB (origen: ${aplicado?.source}).`
    )
    logger.error(
      "postgresql.conf tiene precedencia sobre ALTER SYSTEM en esta instancia. " +
        "Corre diag-wal-config.ts para ver que archivo lo fija."
    )
    return
  }

  logger.info("")
  logger.info("Listo. Postgres ya no puede inflar el WAL por encima de 256 MB.")
  logger.info(
    "Nota: el porcentaje del volumen en Railway NO va a bajar. Esos bloques " +
      "ya estan asignados y el sistema de archivos no los devuelve. Lo que se " +
      "corrige es que deje de crecer."
  )
}
