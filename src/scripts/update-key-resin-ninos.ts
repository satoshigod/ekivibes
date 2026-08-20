/**
 * src/scripts/update-key-resin-ninos.ts
 *
 * Actualiza el producto "Llave de Resina Tipo B Hit-Air" (SKU: KEY-RESIN):
 *   1. Agrega "Niños" al título — es un repuesto especial para jinetes de
 *      bajo peso / niños, distinto de la llave estándar.
 *   2. Reemplaza la descripción (el texto anterior estaba mezclado con el
 *      de la herramienta de rearmado — no correspondía a este producto)
 *      por el texto técnico correcto, traducido de la ficha oficial Hit-Air.
 *   3. Confirma que el producto quede vinculado ÚNICAMENTE al canal de
 *      Ekivibes (nunca debe aparecer en el canal Hit-Air Colombia).
 *
 * No toca ningún otro producto.
 * Ejecutar: npx medusa exec ./src/scripts/update-key-resin-ninos.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

const PRODUCT_ID = "prod_01KZPHKFRVH25ZEC6ZJXRG7CTV";
const EKIVIBES_CHANNEL_ID = "sc_01KZPAP849X2E6DFPE4GDAG7MC"; // TIENDA EKIVIBE COLOMBIA

const TITLE = "Llave de Resina Tipo B Hit-Air Niños";

const DESCRIPTION =
  "Llave de resina (bola de resina) Tipo B, repuesto original Hit-Air para el sistema de activación " +
  "mecánica del chaleco airbag. Diseñada específicamente para jinetes de bajo peso (niños): libera el " +
  "airbag con menos tensión que la llave estándar, ya que el mecanismo cede con mayor facilidad ante " +
  "una caída.\n\n" +
  "*Esta llave de resina no se puede usar en chalecos que originalmente traen una llave metálica — " +
  "no son intercambiables entre sí.\n\n" +
  "Al ser más sensible, debe manipularse con cuidado: el lazo del cable o el conector pueden liberar " +
  "la llave incluso con una tensión leve durante el uso normal (montar, desmontar, ajustar el chaleco). " +
  "Se recomienda revisar que quede bien insertada, sin el punto de color visible, antes de cada salida.";

export default async function updateKeyResinNinos({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: before } = await query.graph({
    entity: "product",
    fields: ["id", "title", "description", "sales_channels.id", "sales_channels.name"],
    filters: { id: PRODUCT_ID },
  });

  if (!before.length) {
    logger.error(`No se encontró el producto ${PRODUCT_ID}. Abortando.`);
    return;
  }

  const current = before[0] as any;
  logger.info(`ANTES — título: "${current.title}"`);
  logger.info(
    `ANTES — canales: ${(current.sales_channels || []).map((c: any) => `${c.name} [${c.id}]`).join(", ") || "(ninguno)"}`
  );

  await updateProductsWorkflow(container).run({
    input: {
      selector: { id: PRODUCT_ID },
      update: {
        title: TITLE,
        description: DESCRIPTION,
        sales_channels: [{ id: EKIVIBES_CHANNEL_ID }],
      },
    },
  });

  const { data: after } = await query.graph({
    entity: "product",
    fields: ["id", "title", "description", "sales_channels.id", "sales_channels.name"],
    filters: { id: PRODUCT_ID },
  });
  const updated = after[0] as any;

  logger.info(`DESPUÉS — título: "${updated.title}"`);
  logger.info(
    `DESPUÉS — canales: ${(updated.sales_channels || []).map((c: any) => `${c.name} [${c.id}]`).join(", ")}`
  );
  logger.info("=== listo ===");
}
