FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN mkdir -p apps/web/public apps/web/.next/standalone/apps/web/.next && cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static && cp -R apps/web/public apps/web/.next/standalone/apps/web/public

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 CONTAINER_RUNTIME=1
COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next/standalone ./apps/web/.next/standalone
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/packages ./packages
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tests/db-native.test.ts ./tests/db-native.test.ts
USER node
ENTRYPOINT ["node", "scripts/container-entrypoint.mjs"]
CMD ["web"]
