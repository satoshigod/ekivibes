/**
 * Seed: Sales Channel "Hit-Air Colombia" + catálogo de motociclismo + inventario.
 *
 * Ejecutar en Railway shell console (servicio "ekivibes" / backend):
 *   npx medusa exec ./src/scripts/seed-hitair-colombia.ts
 *
 * Es idempotente: si el Sales Channel, la API key o las categorías ya existen
 * (por nombre), las reutiliza en vez de duplicarlas. Los productos SÍ se
 * duplicarán si corres el script dos veces (createProductsWorkflow no
 * deduplica por SKU) — revisa en Admin antes de re-ejecutar.
 *
 * ⚠️ ANTES DE CORRER: completa PRICES_COP más abajo con precios reales en
 * pesos colombianos (valor entero, sin puntos). El script se detiene si
 * queda algún precio en 0.
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

// ID confirmado de Bodega Principal (memoria del proyecto)
const BODEGA_PRINCIPAL_ID = "sloc_01KZPAFBNMW4WBK5VRZQA5G1C2";

// ⚠️ COMPLETAR: precios en COP (pesos enteros, ej: 850000). No dejar en 0.
const PRICES_COP: Record<string, number> = {
  "MLV2-RC-BLK": 0, // Chaleco MLV2-RC Black
  "HDS-MS-BLK": 0, // Chaqueta HDS-MS Black
  "MX9-BLK": 0, // Chaqueta MX-9 Black
  "EU7-GRY": 0, // Chaqueta EU7 Dark Grey
  "EU7-BLK": 0, // Chaqueta EU7 Black
  "CO2-60CC-MOTO": 0, // Cartucho CO2 60cc (moto)
  "WIRE-COIL-MOTO": 0, // Cable en espiral
  "BUCKLE-CONN-MOTO": 0, // Conector tipo hebilla
  "TOOLSET-MOTO": 0, // Kit de herramientas de repuesto
  "KEYBALL-ADU-MOTO": 0, // Keyball estándar adulto
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
  "CO2-60CC-MOTO": 28,
  "WIRE-COIL-MOTO": 6,
  "BUCKLE-CONN-MOTO": 8,
  "TOOLSET-MOTO": 4,
  "KEYBALL-ADU-MOTO": 6,
};

export default async function seedHitAirColombia({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const productModuleService = container.resolve(Modules.PRODUCT);

  const missingPrices = Object.entries(PRICES_COP)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missingPrices.length) {
    throw new Error(
      `Faltan precios en PRICES_COP para: ${missingPrices.join(", ")}. Complétalos antes de correr el script.`
    );
  }

  // 1. Sales Channel
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
  let hitairKey = existingKeys[0];
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

  // 3. Vincular Bodega Principal al nuevo canal (para que el stock sea visible)
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: BODEGA_PRINCIPAL_ID, add: [hitairChannel.id] },
  });

  // 4. Shipping profile (reutiliza el mismo de Ekivibes)
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles();
  if (!shippingProfiles.length) {
    throw new Error("No hay shipping profiles en el backend. Crea uno antes de continuar.");
  }
  const shippingProfile = shippingProfiles[0];

  // 5. Categorías
  logger.info("Buscando/creando categorías...");
  const categoryNames = ["Chaquetas y Chalecos", "Accesorios y Repuestos"];
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

  // 6. Productos
  logger.info("Creando productos de motociclismo...");
  const products = [
    {
      title: "Chaleco Hit-Air MLV2-RC (Negro)",
      handle: "hitair-mlv2-rc-vest-black",
      description:
        "Chaleco airbag Hit-Air MLV2-RC para motociclismo, color negro. Sistema de activación mecánica por cordón, protección de cuello, columna y tórax.",
      category_ids: [categories["Chaquetas y Chalecos"]],
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
        "Chaqueta Hit-Air HDS-MS con sistema airbag integrado, color negro, para uso en motociclismo.",
      category_ids: [categories["Chaquetas y Chalecos"]],
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
        "Chaqueta Hit-Air MX-9 con sistema airbag integrado, color negro, orientada a uso off-road/moto.",
      category_ids: [categories["Chaquetas y Chalecos"]],
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
      title: "Chaqueta Hit-Air EU7 (Gris Oscuro)",
      handle: "hitair-eu7-jacket-dark-grey",
      description:
        "Chaqueta Hit-Air EU7 con sistema airbag integrado, color gris oscuro.",
      category_ids: [categories["Chaquetas y Chalecos"]],
      weight: 1400,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Talla", values: ["M", "L"] }],
      variants: [
        {
          title: "M",
          sku: "EU7-GRY-M",
          options: { Talla: "M" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["EU7-GRY"], currency_code: "cop" }],
        },
        {
          title: "L",
          sku: "EU7-GRY-L",
          options: { Talla: "L" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["EU7-GRY"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
    {
      title: "Chaqueta Hit-Air EU7 (Negro)",
      handle: "hitair-eu7-jacket-black",
      description:
        "Chaqueta Hit-Air EU7 con sistema airbag integrado, color negro.",
      category_ids: [categories["Chaquetas y Chalecos"]],
      weight: 1400,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Talla", values: ["M"] }],
      variants: [
        {
          title: "M",
          sku: "EU7-BLK-M",
          options: { Talla: "M" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["EU7-BLK"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
    {
      title: "Cartucho CO2 60cc (Motociclismo)",
      handle: "hitair-co2-60cc-moto",
      description:
        "Cartucho de CO2 de 60cc, repuesto para chalecos y chaquetas airbag Hit-Air de motociclismo.",
      category_ids: [categories["Accesorios y Repuestos"]],
      weight: 100,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Presentación", values: ["Estándar"] }],
      variants: [
        {
          title: "Estándar",
          sku: "CO2-60CC-MOTO",
          options: { Presentación: "Estándar" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["CO2-60CC-MOTO"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
    {
      title: "Cable en Espiral para Motociclismo",
      handle: "hitair-coiled-wire-moto",
      description:
        "Cable en espiral (lanyard) de repuesto para chalecos/chaquetas airbag Hit-Air de motociclismo.",
      category_ids: [categories["Accesorios y Repuestos"]],
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
    {
      title: "Soporte Conector Tipo Hebilla",
      handle: "hitair-buckle-connector-holder-moto",
      description:
        "Soporte/conector tipo hebilla para el sistema de almacenamiento del cable en espiral Hit-Air.",
      category_ids: [categories["Accesorios y Repuestos"]],
      weight: 50,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Presentación", values: ["Estándar"] }],
      variants: [
        {
          title: "Estándar",
          sku: "BUCKLE-CONN-MOTO",
          options: { Presentación: "Estándar" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["BUCKLE-CONN-MOTO"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
    {
      title: "Kit de Herramientas de Repuesto",
      handle: "hitair-spare-tool-set-moto",
      description:
        "Kit de herramientas de repuesto para mantenimiento e instalación de sistemas airbag Hit-Air.",
      category_ids: [categories["Accesorios y Repuestos"]],
      weight: 200,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Presentación", values: ["Estándar"] }],
      variants: [
        {
          title: "Estándar",
          sku: "TOOLSET-MOTO",
          options: { Presentación: "Estándar" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["TOOLSET-MOTO"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
    {
      title: "Keyball Estándar (Adulto)",
      handle: "hitair-keyball-adult-moto",
      description:
        "Keyball (bola de anclaje) estándar para adulto, repuesto del sistema de activación Hit-Air.",
      category_ids: [categories["Accesorios y Repuestos"]],
      weight: 30,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      options: [{ title: "Presentación", values: ["Estándar"] }],
      variants: [
        {
          title: "Estándar",
          sku: "KEYBALL-ADU-MOTO",
          options: { Presentación: "Estándar" },
          manage_inventory: true,
          prices: [{ amount: PRICES_COP["KEYBALL-ADU-MOTO"], currency_code: "cop" }],
        },
      ],
      sales_channels: [{ id: hitairChannel.id }],
    },
  ];

  await createProductsWorkflow(container).run({ input: { products } });
  logger.info("Productos creados.");

  // 7. Inventario: solo para los SKUs recién creados, en Bodega Principal
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
