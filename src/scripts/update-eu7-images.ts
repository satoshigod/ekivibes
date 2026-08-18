/**
 * Agrega imagenes reales al producto EU-7 (actualmente images: [] en Admin).
 * Fuente: fotos oficiales de Mugen Denko / Hit-Air (hit-air.com), enlazadas
 * directamente (no auto-hospedadas) porque el sandbox de Claude no tiene
 * salida de red hacia hit-air.com para descargar los binarios. Mismo criterio
 * usado en HDS-MS.
 * Colores mostrados: Gris Oscuro y Negro (los 2 que existen como variante en
 * la tienda). El oficial tambien tiene Gris Claro, no se incluye foto de ese
 * color porque no hay variante creada para el en Medusa.
 * No toca ningun otro producto (ni de moto ni de equitacion).
 * Ejecutar: npx medusa exec ./src/scripts/update-eu7-images.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

const IMAGE_BASE = "https://www.hit-air.com/archives/005/202508";

export default async function updateEu7Images({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  await updateProductsWorkflow(container).run({
    input: {
      selector: { handle: "hitair-eu7-touring-jacket" },
      update: {
        thumbnail: `${IMAGE_BASE}/3fee64138293dd48b3170a283cabd5a525b3e7268c822281db58b52b7c1b1d42.jpg`,
        images: [
          { url: `${IMAGE_BASE}/3fee64138293dd48b3170a283cabd5a525b3e7268c822281db58b52b7c1b1d42.jpg` }, // Gris Oscuro - frente
          { url: `${IMAGE_BASE}/2fc8c5be69fb8682d37d18329c6c73402c4b8173e4998b7c899affb2107070a3.jpg` }, // Gris Oscuro - espalda
          { url: `${IMAGE_BASE}/62a200a62f3514e98e0686d20409faf51a1e042465a044cf8f16e62a7933a13b.jpg` }, // Negro - frente
          { url: `${IMAGE_BASE}/9d21c9e9114ee8230c9249c3b0c7b38d0403474df6b43b3f76d1d92afdcdfa51.jpg` }, // Negro - espalda
          { url: `${IMAGE_BASE}/c1a78db5b58072b9a538a0d6e24b450e49d8ed9c1655dba1dc6bc667968f7f00.jpg` }, // Caja de llave (Key Box)
          { url: `${IMAGE_BASE}/3bea7f734dd875b74573dbb44c41273b804d808c6c92bba92fdecec51998d810.jpg` }, // Airbag desplegado (foto de referencia en gris claro)
        ],
      },
    },
  });

  logger.info("Imagenes actualizadas para hitair-eu7-touring-jacket.");
}
