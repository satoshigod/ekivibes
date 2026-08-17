/**
 * Verificación de solo lectura — no crea ni modifica nada.
 * Ejecutar: npx medusa exec ./src/scripts/verify-hitair-products.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export default async function verifyHitAirProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
    filters: { name: "Hit-Air Colombia" },
  });
  logger.info(`Sales Channels encontrados con nombre 'Hit-Air Colombia': ${channels.length}`);
  channels.forEach((c) => logger.info(`  -> ${c.id} | ${c.name}`));

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "status", "sales_channels.id", "sales_channels.name"],
    filters: {
      handle: [
        "hitair-mlv2-rc-vest-black",
        "hitair-hds-ms-jacket-black",
        "hitair-mx9-jacket-black",
        "hitair-eu7-touring-jacket",
        "hitair-coiled-wire-moto",
      ],
    },
  });
  logger.info(`Productos Hit-Air encontrados por handle: ${products.length}`);
  products.forEach((p: any) => {
    logger.info(
      `  -> ${p.title} | status=${p.status} | canales=${(p.sales_channels || []).map((sc: any) => sc.name).join(", ")}`
    );
  });

  // Búsqueda amplia por si el handle no coincide (ej. sufijo -1 por duplicado)
  const { data: allRecent } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "status", "created_at"],
  });
  const recentHitair = allRecent
    .filter((p: any) => p.title?.toLowerCase().includes("hit-air"))
    .sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
  logger.info(`Productos con 'Hit-Air' en el título (cualquier canal): ${recentHitair.length}`);
  recentHitair.forEach((p: any) => logger.info(`  -> ${p.title} | ${p.handle} | ${p.status}`));

  const skus = [
    "MLV2-RC-BLK-M", "MLV2-RC-BLK-L", "HDS-MS-BLK-M", "MX9-BLK-M",
    "EU7-GRY-M", "EU7-GRY-L", "EU7-BLK-M", "WIRE-COIL-MOTO",
  ];
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "location_levels.location_id", "location_levels.stocked_quantity"],
    filters: { sku: skus },
  });
  logger.info(`InventoryItems encontrados: ${inventoryItems.length} de ${skus.length} esperados`);
  inventoryItems.forEach((i: any) => {
    logger.info(`  -> ${i.sku} | niveles=${JSON.stringify(i.location_levels)}`);
  });
}
