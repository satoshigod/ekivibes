FROM node:20-slim

WORKDIR /app

# Copiar .npmrc PRIMERO para que todas las instalaciones usen el mirror (evita 429)
COPY .npmrc ./
COPY package.json ./

# Instalar todas las dependencias (necesarias para compilar)
RUN npm install

# Copiar el resto del código
COPY . .

# Compilar Medusa (genera la carpeta .medusa/server)
RUN npm run build

# Instalar dependencias de producción DENTRO de la carpeta compilada,
# usando el mismo mirror para no chocar con el 429
RUN cp .npmrc .medusa/server/.npmrc && cd .medusa/server && npm install --omit=dev

EXPOSE 9000

# Arrancar DESDE la carpeta compilada: migraciones + servidor
CMD cd .medusa/server && npx medusa db:migrate && npm run start
