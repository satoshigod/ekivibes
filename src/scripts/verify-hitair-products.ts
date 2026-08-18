/**
 * Verificacion de solo lectura - no crea ni modifica nada.
 * Ejecutar: npx medusa exec ./src/scripts/verify-hitair-products.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export default async function verifyHitAirProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "is_disabled"],
    filters: { name: "Hit-Air Colombia" },
  });
  logger.info(`Sales Channels 'Hit-Air Colombia': ${channels.length}`);
  channels.forEach((c: any) => logger.info(`  -> ${c.id} | disabled=${c.is_disabled}`));

  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "token", "revoked_at", "sales_channels.id", "sales_channels.name"],
    filters: { title: "Hit-Air Colombia Storefront" },
  });
  logger.info(`API Keys: ${keys.length}`);
  keys.forEach((k: any) =>
    logger.info(
      `  -> ${k.token?.slice(0, 15)}... revoked=${k.revoked_at} canales=${(k.sales_channels || [])
        .map((c: any) => c.name)
        .join(", ")}`
    )
  );

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "status", "sales_channels.id", "sales_channels.name"],
  });
  const hitairProducts = products.filter((p: any) =>
    (p.sales_channels || []).some((sc: any) => sc.name === "Hit-Air Colombia")
  );
  logger.info(`Productos en canal Hit-Air Colombia: ${hitairProducts.length}`);
  hitairProducts.forEach((p: any) =>
    logger.info(`  -> ${p.title} | ${p.handle} | status=${p.status}`)
  );

  if (channels[0]) {
    const { data: locLinks } = await query.graph({
      entity: "sales_channel",
      fields: ["id", "stock_locations.id", "stock_locations.name"],
      filters: { id: channels[0].id },
    });
    logger.info(`Bodegas vinculadas al canal: ${JSON.stringify(locLinks[0]?.stock_locations)}`);
  }
}
