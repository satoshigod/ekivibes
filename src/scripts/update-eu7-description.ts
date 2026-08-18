/**
 * Reemplaza la descripcion corta (placeholder del seed) del producto EU-7
 * por el texto real de la ficha oficial (hit-air.com), traducido.
 * Este campo es el que se muestra en el PDP justo debajo de la galeria de
 * fotos iniciales (componente ProductInfo), antes de "Detalles del producto".
 * No toca ningun otro producto.
 * Ejecutar: npx medusa exec ./src/scripts/update-eu7-description.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

const DESCRIPTION =
  "Chaqueta insignia Hit-Air de estilo europeo, pensada para invierno, con transpirabilidad e " +
  "impermeabilidad. La chaqueta exterior es en ripstop 600D con forro de malla y una membrana " +
  "interior INTERON transpirable e impermeable. El forro térmico interno es desmontable, así que " +
  "se puede usar todo el año quitando o dejando el forro según el clima. Incluye protectores CE " +
  "livianos (EN1621-1, tipo HEXA) en hombros y codos, de serie. El sistema airbag usa cartucho de " +
  "CO2 de 50cc y se activa mecánicamente con el cable en espiral anclado a la moto.";

export default async function updateEu7Description({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  await updateProductsWorkflow(container).run({
    input: {
      selector: { handle: "hitair-eu7-touring-jacket" },
      update: { description: DESCRIPTION },
    },
  });

  logger.info("Descripcion actualizada para hitair-eu7-touring-jacket.");
}
