FROM node:22-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json web/
COPY server/package.json server/package-lock.json server/
RUN npm ci --prefix web && npm ci --prefix server
COPY web web
COPY server server
RUN npm run build --prefix web && npm run build --prefix server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/server/package.json /app/server/package-lock.json server/
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
EXPOSE 3002
CMD ["node", "server/dist/index.js"]
