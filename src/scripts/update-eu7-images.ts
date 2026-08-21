/**
 * Agrega imagenes reales al producto EU-7.
 *
 * Fuente: fotos oficiales de Mugen Denko / Hit-Air, ya AUTO-HOSPEDADAS en
 * public/product-details/ del storefront de Hit-Air Colombia. Antes este
 * script enlazaba directo a hit-air.com; se corrigio porque un hotlink a un
 * CDN de terceros deja la ficha sin fotos si Mugen Denko reorganiza ese
 * directorio, y ademas rompia la regla del proyecto de auto-hospedar. Las
 * imagenes ya estaban descargadas en el repo del storefront, solo faltaba
 * apuntarlas.
 *
 * Colores mostrados: Negro (eu7-main..eu7-04) y Gris (eu7-06..eu7-08), que
 * son las 2 variantes que existen en la tienda. El oficial tambien tiene
 * Gris Claro; no se incluye porque no hay variante creada para ese color.
 *
 * No toca ningun otro producto (ni de moto ni de equitacion).
 * Ejecutar: npx medusa exec ./src/scripts/update-eu7-images.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import { IMAGE_BASE } from "../lib/image-base";

export default async function updateEu7Images({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  await updateProductsWorkflow(container).run({
    input: {
      selector: { handle: "hitair-eu7-touring-jacket" },
      update: {
        thumbnail: `${IMAGE_BASE}/eu7-main.jpg`,
        images: [
          { url: `${IMAGE_BASE}/eu7-main.jpg` }, // Negro - frente
          { url: `${IMAGE_BASE}/eu7-02.jpg` }, // Negro - espalda
          { url: `${IMAGE_BASE}/eu7-03.jpg` }, // Negro - frente, cuello alzado
          { url: `${IMAGE_BASE}/eu7-04.jpg` }, // Negro - 3/4 con capucha desplegada
          { url: `${IMAGE_BASE}/eu7-06.jpg` }, // Gris - frente
          { url: `${IMAGE_BASE}/eu7-07.jpg` }, // Gris - espalda
          { url: `${IMAGE_BASE}/eu7-08.jpg` }, // Gris - 3/4 con capucha desplegada
          { url: `${IMAGE_BASE}/eu7-05.jpg` }, // Detalle: cartucho CO2 alojado
        ],
      },
    },
  });

  logger.info("Imagenes actualizadas para hitair-eu7-touring-jacket (auto-hospedadas).");
}
