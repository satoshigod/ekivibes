FROM node:20-slim

# Instalar dependencias del sistema necesarias para Medusa
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar solo los archivos de dependencias primero (mejor cacheo)
COPY package.json package-lock.json* .npmrc* ./

# Instalar dependencias con configuración robusta
# --prefer-offline usa caché cuando puede; --no-audit acelera; --omit=dev evita paquetes de desarrollo
RUN npm install --omit=dev --no-audit --prefer-offline --loglevel=warn || \
    npm install --omit=dev --no-audit --loglevel=warn

# Copiar el resto del código
COPY . .

# Compilar Medusa
RUN npm run build

# Puerto que expone Medusa
EXPOSE 9000

# Comando de arranque: migraciones + servidor
CMD npx medusa db:migrate && npx medusa start
