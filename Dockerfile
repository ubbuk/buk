# Staging image for the ERP (Next.js app + its API routes, unchanged).
# glibc (Debian) base so the native `bcrypt` binding and Prisma engines work
# without musl quirks. Full node_modules are kept on purpose: the same image
# runs `prisma migrate deploy` and (staging only) `tsx prisma/seed.ts`.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
# `npm ci` fails: the Windows-generated lockfile lacks Linux optional deps
# (@emnapi/*). `npm install` honours the lock and fills the gap in-container,
# leaving the repo's package-lock.json untouched. Fix the lock in a later phase.
RUN npm install --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
