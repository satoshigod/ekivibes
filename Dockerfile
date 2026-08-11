FROM node:20-slim

WORKDIR /app

COPY .npmrc ./
COPY package.json ./

RUN npm install

COPY . .

RUN npm run build

RUN cp .npmrc .medusa/server/.npmrc && cd .medusa/server && npm install --omit=dev

EXPOSE 9000

CMD cd .medusa/server && npx medusa db:migrate && npx medusa exec /app/src/scripts/fix-ninos.ts ; npm run start
