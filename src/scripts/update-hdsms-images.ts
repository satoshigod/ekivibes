/**
 * Actualiza thumbnail + galeria del producto HDS-MS para usar las fotos
 * reales autohospedadas en hitair-colombia-storefront/public/product-details/
 * (reemplaza el hotlink directo a hit-air.com de la version anterior del script).
 * No toca ningun otro producto.
 * Ejecutar: npx medusa exec ./src/scripts/update-hdsms-images.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import { IMAGE_BASE as BASE } from "../lib/image-base";


export default async function updateHdsMsImages({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  await updateProductsWorkflow(container).run({
    input: {
      selector: { handle: "hitair-hds-ms-jacket-black" },
      update: {
        thumbnail: `${BASE}/hdsms-main.jpg`,
        images: [
          { url: `${BASE}/hdsms-main.jpg` },
          { url: `${BASE}/hdsms-back.jpg` },
          { url: `${BASE}/hdsms-keybox.jpg` },
          { url: `${BASE}/hdsms-keyboxcover.jpg` },
        ],
      },
    },
  });

  logger.info("Imagenes actualizadas (autohospedadas) para hitair-hds-ms-jacket-black.");
}
