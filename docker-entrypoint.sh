#!/bin/sh
set -eu

if [ -n "${DATABASE_URL:-}" ]; then
  case "${DATABASE_PROVIDER:-}:${DATABASE_URL}" in
    mysql:*|*:mysql*)
      case "$DATABASE_URL" in
        *sslaccept=*) ;;
        *)
          case "$DATABASE_URL" in
            *\?*) DATABASE_URL="${DATABASE_URL}&sslaccept=strict" ;;
            *) DATABASE_URL="${DATABASE_URL}?sslaccept=strict" ;;
          esac
          export DATABASE_URL
          ;;
      esac
      pnpm --filter @ecogrid/api exec prisma migrate deploy --schema prisma/mysql/schema.prisma
      ;;
    *)
      pnpm --filter @ecogrid/api exec prisma migrate deploy --schema prisma/postgres/schema.prisma
      ;;
  esac
  pnpm --filter @ecogrid/api seed:prod
fi

exec node apps/api/dist/index.js
