/**
 * src/scripts/link-co2-to-hitair-colombia.ts
 *
 * Agrega los cartuchos de CO2 (CO2-50CC, CO2-60CC) al catálogo del Sales
 * Channel "Hit-Air Colombia", ADEMÁS de "TIENDA EKIVIBE COLOMBIA" (no en
 * reemplazo). Es la reversión intencional de la decisión del 13-ago-2026
 * (normalize-store.ts), que los había dejado exclusivos de Ekivibes.
 *
 * No destructivo: usa linkProductsToSalesChannelWorkflow con `add` solamente
 * (nunca `remove`), así que el vínculo con Ekivibes queda intacto. También
 * verifica -y si falta, agrega- el vínculo entre el Publishable Key de
 * Hit-Air Colombia y el canal, para que la Store API no devuelva 404/lista
 * vacía por falta de permiso.
 *
 * Uso, desde /app en el contenedor de Railway (servicio "ekivibes"):
 *   npx medusa exec ./src/scripts/link-co2-to-hitair-colombia.ts
 *
 * Idempotente: si ya está todo vinculado, no hace nada y solo reporta.
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { linkProductsToSalesChannelWorkflow, linkSalesChannelsToApiKeyWorkflow } from "@medusajs/medusa/core-flows";

const HITAIR_CHANNEL_NAME = "Hit-Air Colombia";
const CO2_SKUS = ["CO2-50CC", "CO2-60CC"];

export default async function linkCo2ToHitairColombia({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  // 1. Canal destino — se busca por nombre, NO se crea si no existe (si no
  // existe, algo más grave está mal y no queremos crear uno duplicado).
  const { data: canales } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
    filters: { name: HITAIR_CHANNEL_NAME },
  });
  if (!canales.length) {
    throw new Error(`No existe un Sales Channel llamado "${HITAIR_CHANNEL_NAME}". Abortando.`);
  }
  const hitairChannel = canales[0];
  logger.info(`Canal destino: ${hitairChannel.name} [${hitairChannel.id}]`);

  // 2. Productos CO2 — por SKU de variante (más confiable que handle/título).
  const { data: productos } = await query.graph({
    entity: "product",
    fields: ["id", "title", "status", "variants.sku", "sales_channels.id", "sales_channels.name"],
  });

  const co2Productos = (productos as any[]).filter((p) =>
    (p.variants || []).some((v: any) => CO2_SKUS.includes(v.sku))
  );

  if (!co2Productos.length) {
    throw new Error(
      `No se encontró ningún producto con variantes de SKU ${CO2_SKUS.join(" / ")}. ` +
        `Revisa el SKU real en Admin antes de re-ejecutar.`
    );
  }

  logger.info(`Productos CO2 encontrados: ${co2Productos.length}`);
  for (const p of co2Productos) {
    const canalesActuales = (p.sales_channels || []).map((c: any) => c.name).join(", ") || "ninguno";
    logger.info(`  - "${p.title}" [${p.id}]  canales actuales: ${canalesActuales}`);
  }

  const faltantes = co2Productos.filter(
    (p) => !(p.sales_channels || []).some((c: any) => c.id === hitairChannel.id)
  );

  if (!faltantes.length) {
    logger.info("Los productos CO2 ya están vinculados a Hit-Air Colombia. Nada que hacer.");
  } else {
    logger.info(`Vinculando ${faltantes.length} producto(s) a "${hitairChannel.name}" (add-only, no se quita nada)...`);
    await linkProductsToSalesChannelWorkflow(container).run({
      input: {
        id: hitairChannel.id,
        add: faltantes.map((p) => p.id),
      },
    });
    logger.info("Vínculo creado.");
  }

  // 3. Verificación del Publishable Key de Hit-Air Colombia -> canal.
  const { data: llaves } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "token", "type", "sales_channels.id"],
    filters: { type: "publishable" },
  });

  const hitairKey = (llaves as any[]).find((k) =>
    (k.sales_channels || []).some((sc: any) => sc.id === hitairChannel.id)
  );

  if (!hitairKey) {
    logger.warn(
      `Ningún Publishable Key tiene vinculado el canal "${hitairChannel.name}" todavía. ` +
        `Sin esto, GET /store/products con esa llave devuelve 404/lista vacía. Revisa en Admin.`
    );
  } else {
    logger.info(`Publishable Key OK: "${hitairKey.title}" (${String(hitairKey.token).slice(0, 18)}...) ya está vinculada al canal.`);
  }

  // 4. Verificación final — confirma que Ekivibes NO perdió el vínculo.
  const { data: verificacion } = await query.graph({
    entity: "product",
    fields: ["id", "title", "sales_channels.id", "sales_channels.name"],
    filters: { id: co2Productos.map((p) => p.id) },
  });

  logger.info("=== ESTADO FINAL ===");
  let ekivibesIntacto = true;
  for (const p of verificacion as any[]) {
    const nombres = (p.sales_channels || []).map((c: any) => c.name);
    logger.info(`  "${p.title}": ${nombres.join(", ")}`);
    if (!nombres.includes("TIENDA EKIVIBE COLOMBIA") && !nombres.some((n: string) => /ekivibe/i.test(n))) {
      ekivibesIntacto = false;
    }
  }
  if (!ekivibesIntacto) {
    logger.error("¡ALERTA! Al menos un producto CO2 perdió su vínculo con el canal de Ekivibes. Revisa manualmente.");
  } else {
    logger.info("Confirmado: el vínculo con el canal de Ekivibes sigue intacto en los dos productos.");
  }
}
