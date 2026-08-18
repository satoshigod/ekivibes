/**
 * Agrega imagenes reales al producto HDS-MS (actualmente images: [] en Admin).
 * Fuente: fotos oficiales de Mugen Denko / Hit-Air (hit-air.com), enlazadas
 * directamente (no auto-hospedadas como MLV2-RC) porque el sandbox de Claude
 * no tiene salida de red hacia hit-air.com para descargar los binarios.
 * Si se prefiere auto-hospedar como los demas productos, subir las 4 fotos a
 * hitair-colombia-storefront/public/product-details/ y cambiar las URLs.
 * No toca ningun otro producto (ni de moto ni de equitacion).
 * Ejecutar: npx medusa exec ./src/scripts/update-hdsms-images.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

const IMAGE_BASE = "https://www.hit-air.com/archives/005";

export default async function updateHdsMsImages({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  await updateProductsWorkflow(container).run({
    input: {
      selector: { handle: "hitair-hds-ms-jacket-black" },
      update: {
        thumbnail: `${IMAGE_BASE}/202407/60560090ff03e573d853d04d8fb9a3f4.jpg`,
        images: [
          { url: `${IMAGE_BASE}/202407/60560090ff03e573d853d04d8fb9a3f4.jpg` }, // Negro - frente
          { url: `${IMAGE_BASE}/202407/be76706cf7db871a107865b8a91a05cc.jpg` }, // Negro - espalda
          { url: `${IMAGE_BASE}/202407/d2f1b860790db7bf1bbb14e80ffa052f.jpg` }, // Caja de llave (Key Box)
          { url: `${IMAGE_BASE}/202407/349078635183fa5e63013fd72a493afe.jpg` }, // Cubierta de la caja de llave
        ],
      },
    },
  });

  logger.info("Imagenes actualizadas para hitair-hds-ms-jacket-black.");
}
