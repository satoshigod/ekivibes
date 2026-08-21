/**
 * Base de URL de las imagenes de producto auto-hospedadas.
 *
 * Las fotos viven en public/product-details/ del storefront de Hit-Air
 * Colombia y se sirven por Next.js; Medusa solo guarda la URL como texto en
 * product.thumbnail y product.images.
 *
 * Por que es variable de entorno y no una constante: la URL queda GUARDADA
 * dentro de la base de datos de cada producto. Con el dominio autogenerado de
 * Railway incrustado, el dia que se ponga el dominio real hay que reescribir
 * esos registros. Teniendolo aqui, ese cambio es: actualizar
 * PRODUCT_IMAGE_BASE en Railway y volver a correr los scripts de imagenes,
 * sin tocar codigo.
 *
 * El fallback conserva el comportamiento actual para que nada se rompa si la
 * variable no esta definida.
 */
export const IMAGE_BASE =
  process.env.PRODUCT_IMAGE_BASE ||
  "https://hitair-colombia-storefront-production.up.railway.app/product-details";
