FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY web/package.json web/
COPY server/package.json server/
COPY web web
COPY server server
RUN npm install && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
EXPOSE 3002
CMD ["node", "server/dist/index.js"]
