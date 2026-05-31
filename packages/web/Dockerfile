FROM yamlresume/yamlresume-base:v1.0.0 AS builder

LABEL maintainer="YAMLResume <https://yamlresume.dev>"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/web/package.json packages/web/package.json

RUN pnpm install --frozen-lockfile

COPY packages/core packages/core
COPY packages/web packages/web
COPY tsconfig.base.json tsup.config.base.ts vitest.config.base.mts ./

RUN pnpm --filter @yamlresume/core build
RUN pnpm --filter @yamlresume/web build

FROM yamlresume/yamlresume-base:v1.0.0 AS runner

LABEL maintainer="YAMLResume <https://yamlresume.dev>"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN useradd -m -u 2048 yamlresume

WORKDIR /app

COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=builder /app/packages/web/public ./packages/web/public

USER yamlresume

EXPOSE 3000

CMD ["node", "packages/web/server.js"]
