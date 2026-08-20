/**
 * src/scripts/fix-keyball-inventory-title.ts
 *
 * Normaliza el titulo del InventoryItem de KEY-BALL-B a "<Producto> - Estandar"
 * (ASCII), siguiendo exactamente la misma convencion ya usada en el paso 6b de
 * seed-hitair-colombia.ts. Sin este fix, en Admin > Inventory el ítem aparece
 * solo como "Estandar" — no identificable para quien despacha.
 *
 * Se me olvidó aplicar este paso al crear KEY-BALL-B (create-keyball-set-b.ts
 * no lo incluía). Este script solo toca el InventoryItem de ese SKU.
 *
 * Ejecutar: npx medusa exec ./src/scripts/fix-keyball-inventory-title.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

const SKU = "KEY-BALL-B";

const ascii = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .replace(/\s+/g, " ")
    .trim();

export default async function fixKeyballInventoryTitle({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const inventoryService = container.resolve(Modules.INVENTORY);

  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "title", "variants.title", "variants.product.title"],
    filters: { sku: [SKU] },
  });

  if (!items.length) {
    logger.error(`No se encontró InventoryItem para ${SKU}. Nada que hacer.`);
    return;
  }

  const it = items[0] as any;
  const v = (it.variants || [])[0];
  if (!v?.product?.title) {
    logger.error(`No se pudo resolver producto/variante para ${SKU}.`);
    return;
  }

  const prod = ascii(v.product.title);
  const varia = ascii(v.title || "");
  const newTitle = !varia || /^default variant$/i.test(varia) ? prod : `${prod} - ${varia}`;

  logger.info(`Título actual: "${it.title}" -> nuevo: "${newTitle}"`);
  await inventoryService.updateInventoryItems([{ id: it.id, title: newTitle }]);
  logger.info("Título de InventoryItem actualizado.");
}
