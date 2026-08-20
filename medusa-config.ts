import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS || "*",
      adminCors: process.env.ADMIN_CORS || "*",
      authCors: process.env.AUTH_CORS || "*",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  modules: [
    ...(process.env.REDIS_URL
      ? [
          {
            resolve: "@medusajs/medusa/cache-redis",
            options: { redisUrl: process.env.REDIS_URL },
          },
          {
            resolve: "@medusajs/medusa/event-bus-redis",
            options: { redisUrl: process.env.REDIS_URL },
          },
          {
            resolve: "@medusajs/medusa/workflow-engine-redis",
            options: { redis: { url: process.env.REDIS_URL } },
          },
          {
            // Sin esto Medusa cae al proveedor en memoria, valido solo para
            // una instancia. El endpoint que ajusta inventario desde el
            // puente NocoDB (src/api/hooks/nocodb/movimiento/route.ts) y las
            // reservas del checkout comparten el mismo inventory_item, y sin
            // lock distribuido pueden pisarse entre si.
            resolve: "@medusajs/medusa/locking",
            options: {
              providers: [
                {
                  resolve: "@medusajs/medusa/locking-redis",
                  id: "locking-redis",
                  is_default: true,
                  options: { redisUrl: process.env.REDIS_URL },
                },
              ],
            },
          },
        ]
      : []),
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "./src/services/wompi-provider",
            id: "wompi",
            options: {
              // .trim(): las llaves copiadas a Railway traen saltos de linea
              publicKey: (process.env.WOMPI_PUBLIC_KEY || "").trim(),
              privateKey: (process.env.WOMPI_PRIVATE_KEY || "").trim(),
              integritySecret: (process.env.WOMPI_INTEGRITY_SECRET || "").trim(),
              env: (process.env.WOMPI_ENV || "test").trim(),
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "./src/modules/envia-fulfillment",
            id: "envia",
            options: {
              apiToken: (process.env.ENVIA_API_TOKEN || "").trim(),
              env: (process.env.ENVIA_ENV || "sandbox").trim(),
              shippingBase:
                (process.env.ENVIA_ENV || "sandbox").trim() === "production"
                  ? "https://api.envia.com"
                  : "https://api-test.envia.com",
              queriesBase:
                (process.env.ENVIA_ENV || "sandbox").trim() === "production"
                  ? "https://queries.envia.com"
                  : "https://queries-test.envia.com",
              origin: {
                name: process.env.ENVIA_ORIGIN_NAME,
                phone: process.env.ENVIA_ORIGIN_PHONE,
                street: process.env.ENVIA_ORIGIN_STREET,
                city: process.env.ENVIA_ORIGIN_CITY,
                state: process.env.ENVIA_ORIGIN_STATE,
                postalCode: process.env.ENVIA_ORIGIN_POSTAL_CODE,
                country: process.env.ENVIA_ORIGIN_COUNTRY || "CO",
              },
              defaultPackage: {
                weightKg: Number(process.env.ENVIA_DEFAULT_WEIGHT_KG || "1.5"),
                lengthCm: Number(process.env.ENVIA_DEFAULT_LENGTH_CM || "30"),
                widthCm: Number(process.env.ENVIA_DEFAULT_WIDTH_CM || "25"),
                heightCm: Number(process.env.ENVIA_DEFAULT_HEIGHT_CM || "15"),
                declaredValue: Number(process.env.ENVIA_DEFAULT_DECLARED_VALUE || "150000"),
              },
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "./src/modules/resend",
            id: "resend",
            options: {
              channels: ["email"],
              api_key: process.env.RESEND_API_KEY,
              from: process.env.RESEND_FROM_EMAIL,
            },
          },
        ],
      },
    },
  ],
})
