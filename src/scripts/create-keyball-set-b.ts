/**
 * src/scripts/create-keyball-set-b.ts
 *
 * Crea el producto "Llave de Bola con Conector Tipo Hebilla (Tipo B) Hit-Air"
 * (SKU: KEY-BALL-B) — set de repuesto (llave de bola metálica + hebilla
 * conectora hembra) para el cable en espiral del sistema de activación
 * mecánica Hit-Air. Es un ítem GENÉRICO compartido por los dos segmentos
 * (equitación y motociclismo), igual que CO2-50CC/CO2-60CC: UN solo
 * producto, vinculado a los DOS Sales Channels desde su creación.
 *
 * No toca ningún otro producto existente. No crea categorías nuevas si ya
 * existe una razonable para reutilizar (log informativo si no encuentra
 * ninguna — no bloquea la creación del producto).
 *
 * Ejecutar en Railway shell console (servicio "ekivibes" / backend):
 *   npx medusa exec ./src/scripts/create-keyball-set-b.ts
 *
 * Idempotente parcialmente: si el SKU KEY-BALL-B ya existe, aborta sin
 * crear un duplicado (createProductsWorkflow no deduplica por SKU).
 */
import { ExecArgs, CreateInventoryLevelInput } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows";

const EKIVIBES_CHANNEL_NAME = "TIENDA EKIVIBE COLOMBIA";
const HITAIR_CHANNEL_NAME = "Hit-Air Colombia";
const BODEGA_NOMBRE = "Bodega Principal";
const SKU = "KEY-BALL-B";
const IMAGE_MAIN =
  "https://hitair-colombia-storefront-production.up.railway.app/product-details/keyball-set-b-main.jpg";
const IMAGE_KEYBOX =
  "https://hitair-colombia-storefront-production.up.railway.app/product-details/keyball-set-b-keybox-es.jpg";

// PVP = Costo NETO x 2.2 (misma fórmula usada en seed-hitair-colombia.ts:
// PVP = Costo NETO x 2.2, precio distribuidor = Costo NETO x 1.45).
// Costo NETO dado por Ivan: $27.000 COP sin IVA.
// PVP calculado: 27.000 x 2.2 = 59.400 -> redondeado a $60.000 COP (IVA incluido).
// Precio distribuidor de referencia: 27.000 x 1.45 = 39.150 -> $39.000 COP
// (NO se carga en Medusa, es solo referencia informativa para Ivan).
const PVP_COP = 60000;
const INITIAL_STOCK = 10; // Cantidad supuesta a falta de dato — AJUSTAR en Admin si difiere.

const DESCRIPTION =
  "Set de repuesto original Hit-Air: llave de bola metálica + hebilla conectora hembra (Tipo B), " +
  "para conectar y desconectar el cable en espiral (coiled wire) del sistema de activación mecánica " +
  "del chaleco o chaqueta airbag. Reemplaza el conjunto llave-hebilla cuando se daña, se pierde o se " +
  "desgasta por el uso. Compatible con los chalecos y chaquetas Hit-Air de equitación y motociclismo " +
  "que usan el sistema de hebilla (no incluye el cable en espiral, que se vende por separado).\n\n" +
  "¿Dónde se conecta? La llave de bola se inserta en la Key Box (caja de llave) montada en la parte " +
  "trasera/superior del chaleco o chaqueta, entre los broches de sujeción. Al insertarla queda firme " +
  "dentro del mecanismo; si el usuario cae y el cable en espiral hace tensión, la llave se libera de la " +
  "Key Box y activa el inflado del airbag.\n\n" +
  "Modo de uso:\n" +
  "1. Retira el conjunto llave-hebilla dañado del extremo del cable en espiral.\n" +
  "2. Encaja la nueva hebilla conectora en el mismo punto de anclaje del cable.\n" +
  "3. Inserta la llave de bola en la Key Box del chaleco/chaqueta hasta sentirla firme (ver foto de referencia).\n" +
  "4. Haz una prueba de tensión suave para confirmar que el sistema se libera correctamente ante una caída.";

export default async function createKeyballSetB({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);

  // 0. Guard: aborta si el SKU ya existe (evita duplicados).
  const { data: existentes } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "product.title"],
    filters: { sku: [SKU] },
  });
  if (existentes.length) {
    logger.error(
      `SKU ${SKU} ya existe en "${(existentes[0] as any).product?.title}". Abortando para no duplicar.`
    );
    return;
  }

  // 1. Canales — resueltos por nombre, NO se crean si faltan.
  const { data: canales } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
    filters: { name: [EKIVIBES_CHANNEL_NAME, HITAIR_CHANNEL_NAME] },
  });
  const ekivibesChannel = canales.find((c) => c.name === EKIVIBES_CHANNEL_NAME);
  const hitairChannel = canales.find((c) => c.name === HITAIR_CHANNEL_NAME);
  if (!ekivibesChannel || !hitairChannel) {
    throw new Error(
      `Faltan canales. Ekivibes: ${!!ekivibesChannel}, Hit-Air Colombia: ${!!hitairChannel}. Abortando.`
    );
  }
  logger.info(`Canales: ${ekivibesChannel.name} [${ekivibesChannel.id}], ${hitairChannel.name} [${hitairChannel.id}]`);

  // 2. Bodega — resuelta por nombre.
  const { data: bodegas } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
    filters: { name: BODEGA_NOMBRE },
  });
  if (!bodegas.length) throw new Error(`No existe la bodega "${BODEGA_NOMBRE}". Abortando.`);
  const bodegaId = bodegas[0].id;

  // 3. Shipping profile — el primero disponible (mismo patrón que seed-hitair-colombia.ts).
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles();
  if (!shippingProfiles.length) throw new Error("No hay shipping profiles configurados.");
  const shippingProfile = shippingProfiles[0];

  // 4. Categorías — best-effort, no bloquea la creación si no encuentra nada razonable.
  const { data: todasCategorias } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
  });
  logger.info(`Categorías existentes: ${todasCategorias.map((c) => c.name).join(", ") || "(ninguna)"}`);

  let motoCat = (todasCategorias as any[]).find((c) => /accesor/i.test(c.name) && /moto/i.test(c.name));
  let equCat = (todasCategorias as any[]).find((c) => /accesor/i.test(c.name) && !/moto/i.test(c.name));

  if (!equCat) {
    logger.info('No se encontró categoría de accesorios de equitación. Creando "Accesorios Equitación"...');
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: { product_categories: [{ name: "Accesorios Equitación", is_active: true }] },
    });
    equCat = result[0];
  }

  const categoryIds = [motoCat?.id, equCat?.id].filter(Boolean) as string[];
  logger.info(
    `Categorías a usar: moto=${motoCat?.name ?? "(ninguna, no se encontró)"}  equitación=${equCat?.name}`
  );

  // 5. Crear el producto — UN solo producto, vinculado a los DOS canales.
  await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Llave de Bola con Conector Tipo Hebilla (Tipo B) Hit-Air",
          handle: "llave-bola-conector-hebilla-tipo-b-hitair",
          description: DESCRIPTION,
          status: ProductStatus.PUBLISHED,
          category_ids: categoryIds,
          weight: 40,
          shipping_profile_id: shippingProfile.id,
          thumbnail: IMAGE_MAIN,
          images: [{ url: IMAGE_MAIN }, { url: IMAGE_KEYBOX }],
          options: [{ title: "Presentación", values: ["Estándar"] }],
          variants: [
            {
              title: "Estándar",
              sku: SKU,
              options: { Presentación: "Estándar" },
              manage_inventory: true,
              prices: [{ amount: PVP_COP, currency_code: "cop" }],
            },
          ],
          sales_channels: [{ id: ekivibesChannel.id }, { id: hitairChannel.id }],
        },
      ],
    },
  });
  logger.info(`Producto creado con SKU ${SKU}, vinculado a ambos canales.`);

  // 6. Inventario en Bodega Principal.
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
    filters: { sku: [SKU] },
  });
  if (!inventoryItems.length) {
    logger.error(`No se encontró InventoryItem para ${SKU} tras la creación. Revisar manualmente.`);
  } else {
    const inventoryLevels: CreateInventoryLevelInput[] = [
      {
        inventory_item_id: inventoryItems[0].id,
        location_id: bodegaId,
        stocked_quantity: INITIAL_STOCK,
      },
    ];
    await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: inventoryLevels } });
    logger.info(`Inventario asignado: ${INITIAL_STOCK} uds en ${BODEGA_NOMBRE} (AJUSTAR si el stock real difiere).`);
  }

  // 7. Verificación final.
  const { data: verificacion } = await query.graph({
    entity: "product",
    fields: ["id", "title", "status", "sales_channels.name", "variants.sku", "variants.prices.amount"],
    filters: { handle: "llave-bola-conector-hebilla-tipo-b-hitair" },
  });
  logger.info("=== RESUMEN ===");
  for (const p of verificacion as any[]) {
    logger.info(`"${p.title}" [${p.status}] — canales: ${(p.sales_channels || []).map((c: any) => c.name).join(", ")}`);
  }
}
