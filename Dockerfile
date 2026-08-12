FROM node:20-slim

WORKDIR /app

COPY .npmrc ./
COPY package.json ./

RUN npm install

COPY . .

RUN npm run build

RUN cp .npmrc .medusa/server/.npmrc && cd .medusa/server && npm install --omit=dev

EXPOSE 9000

# Migraciones + servidor. Los scripts de mantenimiento se corren
# manualmente via GitHub Actions, no en cada arranque.
CMD cd .medusa/server && npx medusa db:migrate && npm run start
