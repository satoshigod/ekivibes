/**
 * Seed: Sales Channel "Hit-Air Colombia" + catálogo de motociclismo + inventario.
 *
 * Alcance EXACTO (no tocar equitación / no crear nada fuera de esto):
 *   - MLV2-RC Vest (Negro): M x4, L x2
 *   - HDS-MS Jacket (Negro): M x1
 *   - MX-9 Jacket (Negro): M x1
 *   - EU7 Jacket: Gris Oscuro (M x1, L x1) + Negro (M x1) — UN solo producto,
 *     Color y Talla como opciones. Negro NO tiene talla L.
 *   - Motorcycle Coiled Wire: 6 uds, sin talla.
 *
 * Ejecutar en Railway shell console (servicio "ekivibes" / backend):
 *   npx medusa exec ./src/scripts/seed-hitair-colombia.ts
 *
 * Idempotente para Sales Channel / API Key / Categorías (busca por nombre
 * antes de crear). Los productos SÍ se duplican si se corre dos veces
 * (createProductsWorkflow no deduplica por SKU) — revisa en Admin antes de
 * re-ejecutar.
 *
 * NO toca: productos, categorías, sales channels o bodegas de Ekivibes/equitación.
 * Solo agrega inventario NUEVO para los SKUs de esta lista, en Bodega Principal.
 */
import { ExecArgs, CreateInventoryLevelInput } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

// ID confirmado de Bodega Principal (memoria del proyecto) — misma bodega
// física de Ekivibes, solo se le agregan niveles de inventario nuevos.
const BODEGA_PRINCIPAL_ID = "sloc_01KZPAFBNMW4WBK5VRZQA5G1C2";

// PVP en COP (pesos enteros), calculado sobre Costo NETO dado por Ivan:
// PVP = Costo NETO x 2.2 (margen retail ~55% sobre precio distribuidor,
// distribuidor = Costo NETO x 1.45). Ajustable en Admin si Ivan lo prefiere distinto.
const PRICES_COP: Record<string, number> = {
  "MLV2-RC-BLK": 2020000,
  "HDS-MS-BLK": 3130000,
  "MX9-BLK": 2930000,
  "EU7-JKT": 3430000, // aplica a ambos colores del mismo producto
  "WIRE-COIL-MOTO": 140000,
};

// Cantidades exactas dadas por Ivan
const QUANTITIES: Record<string, number> = {
  "MLV2-RC-BLK-M": 4,
  "MLV2-RC-BLK-L": 2,
  "HDS-MS-BLK-M": 1,
  "MX9-BLK-M": 1,
  "EU7-GRY-M": 1,
  "EU7-GRY-L": 1,
  "EU7-BLK-M": 1,
  "WIRE-COIL-MOTO": 6,
};

export default async function seedHitAirColombia({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const productModuleService = container.resolve(Modules.PRODUCT);

  // 1. Sales Channel (busca por nombre, no crea duplicado si ya existe)
  logger.info("Buscando/creando Sales Channel 'Hit-Air Colombia'...");
  let [hitairChannel] = await salesChannelModuleService.listSalesChannels({
    name: "Hit-Air Colombia",
  });
  if (!hitairChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          {
            name: "Hit-Air Colombia",
            description: "Canal exclusivo de motociclismo - productos Hit-Air Colombia",
          },
        ],
      },
    });
    hitairChannel = result[0];
  }
  logger.info(`Sales Channel ID: ${hitairChannel.id}`);

  // 2. Publishable API Key para el nuevo storefront
  logger.info("Buscando/creando Publishable API Key...");
  const { data: existingKeys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "token", "type"],
    filters: { title: "Hit-Air Colombia Storefront", type: "publishable" },
  });
  let hitairKey: { id: string; token: string } | undefined = existingKeys[0];
  if (!hitairKey) {
    const { result: keyResult } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: "Hit-Air Colombia Storefront",
            type: "publishable",
            created_by: "system",
          },
        ],
      },
    });
    hitairKey = keyResult[0];
  }
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: hitairKey.id, add: [hitairChannel.id] },
  });
  logger.info(`Publishable Key: ${hitairKey.token}`);

  // 3. Vincular Bodega Principal al nuevo canal (NO se toca ni se remueve
  // su vínculo existente con el canal de Ekivibes — solo se le AGREGA este).
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: BODEGA_PRINCIPAL_ID, add: [hitairChannel.id] },
  });

  // 4. Shipping profile (reutiliza el mismo que usa Ekivibes, sin modificarlo)
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles();
  if (!shippingProfiles.length) {
    throw new Error("No hay shipping profiles en el backend. Crea uno antes de continuar.");
  }
  const shippingProfile = shippingProfiles[0];

  // 5. Categorías nuevas y exclusivas de moto (no reutiliza categorías de Ekivibes)
  logger.info("Buscando/creando categorías de motociclismo...");
  const categoryNames = ["Chaquetas y Chalecos Moto", "Accesorios Moto"];
  const categories: Record<string, string> = {};
  for (const name of categoryNames) {
    const [existing] = await productModuleService.listProductCategories({ name });
    if (existing) {
      categories[name] = existing.id;
    } else {
      const { result } = await createProductCategoriesWorkflow(container).run({
        input: { product_categories: [{ name, is_active: true }] },
      });
      categories[name] = result[0].id;
    }
  }

  // 6. Productos (exactamente los 5 de la lista de Ivan)
  logger.info("Creando productos de motociclismo...");
  const products = [
    {
      title: "Chaleco Hit-Air MLV2-RC (Negro)",
      handle: "hitair-mlv2-rc-vest-black",
      description:
        "Chaleco airbag Hit-Air MLV2-RC para motociclismo, color negro. Sistema de activación mecánica por cordón, protección de cuello, columna y tórax.",
      category_ids: [categories["Chaquetas y Chalecos Moto"]],
      weight: 900,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Talla", values: ["M", "L"] }],
      variants: [
        {
          title: "M",
          sku: "MLV2-RC-BLK-M",
          options: { Talla: "M" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["MLV2-RC-BLK"], currency_code: "cop" }],
        },
        {
          title: "L",
          sku: "MLV2-RC-BLK-L",
          options: { Talla: "L" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["MLV2-RC-BLK"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
    {
      title: "Chaqueta Hit-Air HDS-MS (Negro)",
      handle: "hitair-hds-ms-jacket-black",
      description:
        "Chaqueta Hit-Air HDS-MS con sistema airbag integrado, color negro, para uso urbano en motociclismo.",
      category_ids: [categories["Chaquetas y Chalecos Moto"]],
      weight: 1400,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Talla", values: ["M"] }],
      variants: [
        {
          title: "M",
          sku: "HDS-MS-BLK-M",
          options: { Talla: "M" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["HDS-MS-BLK"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
    {
      title: "Chaqueta Hit-Air MX-9 (Negro)",
      handle: "hitair-mx9-jacket-black",
      description:
        "Chaqueta Hit-Air MX-9 con sistema airbag integrado, color negro, orientada a uso enduro/adventure en motociclismo.",
      category_ids: [categories["Chaquetas y Chalecos Moto"]],
      weight: 1400,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Talla", values: ["M"] }],
      variants: [
        {
          title: "M",
          sku: "MX9-BLK-M",
          options: { Talla: "M" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["MX9-BLK"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
    {
      // Un solo producto EU7 con Color + Talla. Negro solo existe en M.
      title: "Chaqueta Hit-Air EU7 Touring",
      handle: "hitair-eu7-touring-jacket",
      description:
        "Chaqueta Hit-Air EU7 Touring con sistema airbag integrado. Disponible en gris oscuro (M, L) y negro (M).",
      category_ids: [categories["Chaquetas y Chalecos Moto"]],
      weight: 1500,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [
        { title: "Color", values: ["Gris Oscuro", "Negro"] },
        { title: "Talla", values: ["M", "L"] },
      ],
      variants: [
        {
          title: "Gris Oscuro / M",
          sku: "EU7-GRY-M",
          options: { Color: "Gris Oscuro", Talla: "M" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["EU7-JKT"], currency_code: "cop" }],
        },
        {
          title: "Gris Oscuro / L",
          sku: "EU7-GRY-L",
          options: { Color: "Gris Oscuro", Talla: "L" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["EU7-JKT"], currency_code: "cop" }],
        },
        {
          title: "Negro / M",
          sku: "EU7-BLK-M",
          options: { Color: "Negro", Talla: "M" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["EU7-JKT"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
    {
      title: "Cable en Espiral Hit-Air (Motociclismo)",
      handle: "hitair-coiled-wire-moto",
      description:
        "Cable en espiral (lanyard) de repuesto para chalecos/chaquetas airbag Hit-Air de motociclismo.",
      category_ids: [categories["Accesorios Moto"]],
      weight: 80,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Presentación", values: ["Estándar"] }],
      variants: [
        {
          title: "Estándar",
          sku: "WIRE-COIL-MOTO",
          options: { Presentación: "Estándar" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["WIRE-COIL-MOTO"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
  ];

  await createProductsWorkflow(container).run({ input: { products } });
  logger.info("Productos creados.");

  // 7. Inventario: SOLO para los SKUs de esta lista, en Bodega Principal.
  // No toca ningún InventoryItem existente de Ekivibes/equitación.
  logger.info("Asignando inventario en Bodega Principal...");
  const skus = Object.keys(QUANTITIES);
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
    filters: { sku: skus },
  });

  const inventoryLevels: CreateInventoryLevelInput[] = inventoryItems.map((item) => ({
    inventory_item_id: item.id,
    location_id: BODEGA_PRINCIPAL_ID,
    stocked_quantity: QUANTITIES[item.sku as string] ?? 0,
  }));

  const missing = skus.filter((s) => !inventoryItems.find((i) => i.sku === s));
  if (missing.length) {
    logger.warn(`No se encontró InventoryItem para: ${missing.join(", ")}`);
  }

  await createInventoryLevelsWorkflow(container).run({
    input: { inventory_levels: inventoryLevels },
  });

  logger.info("=== RESUMEN ===");
  logger.info(`Sales Channel ID: ${hitairChannel.id}`);
  logger.info(`Publishable Key: ${hitairKey.token}`);
  logger.info("Guarda el Publishable Key: va en NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY del nuevo storefront.");
}
