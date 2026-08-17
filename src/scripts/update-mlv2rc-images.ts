/**
 * Agrega imagenes reales al producto MLV2-RC (actualmente images: [] en Admin).
 * No toca ningun otro producto (ni de moto ni de equitacion).
 * Ejecutar: npx medusa exec ./src/scripts/update-mlv2rc-images.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

const IMAGE_BASE = "https://hitair-colombia-storefront-production.up.railway.app/product-details";

export default async function updateMlv2RcImages({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  await updateProductsWorkflow(container).run({
    input: {
      selector: { handle: "hitair-mlv2-rc-vest-black" },
      update: {
        thumbnail: `${IMAGE_BASE}/mlv2-rc-main.jpg`,
        images: [
          { url: `${IMAGE_BASE}/mlv2-rc-main.jpg` },
          { url: `${IMAGE_BASE}/mlv2-rc-det2.jpg` },
          { url: `${IMAGE_BASE}/mlv2-rc-det3.jpg` },
          { url: `${IMAGE_BASE}/mlv2-rc-det4.jpg` },
        ],
      },
    },
  });

  logger.info("Imagenes actualizadas para hitair-mlv2-rc-vest-black.");
}
