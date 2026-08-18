/**
 * Reemplaza la descripcion corta (placeholder del seed) del producto HDS-MS
 * por el texto real de la ficha oficial (hit-air.com), traducido.
 * Este campo es el que se muestra en el PDP justo debajo de la galeria de
 * fotos iniciales (componente ProductInfo), antes de "Detalles del producto".
 * No toca ningun otro producto.
 * Ejecutar: npx medusa exec ./src/scripts/update-hdsms-description.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

const DESCRIPTION =
  "Chaqueta con capucha y sistema airbag integrado, en malla, que combina estilo urbano deportivo " +
  "con seguridad. El exterior combina malla transpirable brillante y nylon mate. Incorpora una " +
  "cubierta discreta para el cartucho de CO2 y un orificio de salida en 3D para el conector de la " +
  "llave de resina. Trae de serie protectores CE (EN1621-1) tipo HEXA, livianos, en hombros y codos, " +
  "mas protector de espalda blando. El sistema de airbag es desmontable de la chaqueta.";

export default async function updateHdsMsDescription({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  await updateProductsWorkflow(container).run({
    input: {
      selector: { handle: "hitair-hds-ms-jacket-black" },
      update: { description: DESCRIPTION },
    },
  });

  logger.info("Descripcion actualizada para hitair-hds-ms-jacket-black.");
}
