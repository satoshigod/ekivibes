/**
 * Agrega imagenes reales al producto MX-9 (actualmente images: [] en Admin).
 * No toca ningun otro producto (ni de moto ni de equitacion).
 * Ejecutar: npx medusa exec ./src/scripts/update-mx9-images.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

const IMAGE_BASE = "https://hitair-colombia-storefront-production.up.railway.app/product-details";

export default async function updateMx9Images({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  await updateProductsWorkflow(container).run({
    input: {
      selector: { handle: "hitair-mx9-jacket-black" },
      update: {
        thumbnail: `${IMAGE_BASE}/mx9-main.jpg`,
        images: [
          { url: `${IMAGE_BASE}/mx9-main.jpg` },
          { url: `${IMAGE_BASE}/mx9-det2.jpg` },
          { url: `${IMAGE_BASE}/mx9-det3.jpg` },
          { url: `${IMAGE_BASE}/mx9-det4.jpg` },
        ],
      },
    },
  });

  logger.info("Imagenes actualizadas para hitair-mx9-jacket-black.");
}
