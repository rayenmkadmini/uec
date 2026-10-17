#!/usr/bin/env bash
# Local, disposable Supabase staging stack (Git Bash on Windows).
#
#   staging-local/stack.sh up        # create everything (schema + 3 pending migrations + synthetic seed)
#   staging-local/stack.sh status    # containers and published ports
#   staging-local/stack.sh auth 5    # recreate only Auth with a 5 s link lifetime (expiry test)
#   staging-local/stack.sh down      # remove every ue-stage-* container, the network and the build
#
# Safety:
#   - Never contacts a Supabase project: no --linked, no project ref, no production keys.
#   - Fresh random JWT secret and keys (gen-keys.mjs), not the CLI demo keys.
#   - Every service sits on the private network ue-stage-net. Only the gateway is
#     published, and only on 127.0.0.1:54321. The test site is served on 127.0.0.1:5500.
#   - Every database command first checks that the target is the labelled local container.
#   - Production schema only (schema-only backup files); no production rows.
set -euo pipefail
export MSYS_NO_PATHCONV=1

HERE="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)"
REPO="$(cd "$HERE/.." && pwd -W 2>/dev/null || pwd)"
BACKUP_DIR="${UE_BACKUP_DIR:-C:/Users/Rayen Mkadmini/uec-backups/2026-10-15}"
NET=ue-stage-net
LABEL=ue-stage=local
PG_IMAGE=public.ecr.aws/supabase/postgres:17.11.0.002
AUTH_IMAGE=public.ecr.aws/supabase/gotrue:v2.197.0
REST_IMAGE=public.ecr.aws/supabase/postgrest:v16.3
STORAGE_IMAGE=public.ecr.aws/supabase/storage-api:v1.77.0
EDGE_IMAGE=public.ecr.aws/supabase/edge-runtime:v1.76.2
GATEWAY_IMAGE=public.ecr.aws/docker/library/nginx:1.27-alpine
SITE=http://127.0.0.1:5500
API=http://127.0.0.1:54321

log() { printf '[stack] %s\n' "$*"; }

load_env() {
  node "$HERE/gen-keys.mjs" >/dev/null
  set -a; . "$HERE/.secrets/stack.env"; set +a
}

# Refuses to run SQL anywhere but the labelled local staging database.
db_target_check() {
  local label net
  label="$(docker inspect -f '{{index .Config.Labels "ue-stage"}}' ue-stage-db 2>/dev/null || true)"
  net="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' ue-stage-db 2>/dev/null || true)"
  [ "$label" = "local" ] && [ "$net" = "$NET " ] || { echo "ABORT: ue-stage-db is not the labelled local staging database" >&2; exit 1; }
  [ -z "$(docker port ue-stage-db 2>/dev/null)" ] || { echo "ABORT: database has published ports" >&2; exit 1; }
}

psql_file() { # $1 = path inside container, $2 = role
  db_target_check
  docker exec -e PGOPTIONS="-c client_min_messages=warning" ue-stage-db \
    psql -U "${2:-supabase_admin}" -d postgres -X -q -v ON_ERROR_STOP=1 -f "$1"
}

copy_in() { db_target_check; docker cp "$1" "ue-stage-db:$2"; }

wait_for() { # $1 = description, $2.. = command
  local what="$1"; shift
  for _ in $(seq 1 90); do "$@" >/dev/null 2>&1 && { log "$what ready"; return 0; }; sleep 2; done
  echo "timeout waiting for $what" >&2; exit 1
}

probe() { docker exec ue-stage-gateway wget -q -O /dev/null "$1"; }
# Any HTTP answer (the functions router answers 404 for "/").
probe_any() { docker exec ue-stage-gateway sh -c "wget -S -q -O /dev/null '$1' 2>&1 | grep -q 'HTTP/'"; }

start_auth() { # $1 = link / OTP lifetime in seconds (default 3600)
  load_env
  docker rm -f ue-stage-auth >/dev/null 2>&1 || true
  log "auth (GoTrue, runs its own migrations; link lifetime ${1:-3600}s)"
  docker run -d --name ue-stage-auth --label "$LABEL" --network "$NET" \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 \
    -e API_EXTERNAL_URL="$API/auth/v1" \
    -e GOTRUE_MAILER_URLPATHS_INVITE="$API/auth/v1/verify" \
    -e GOTRUE_MAILER_URLPATHS_CONFIRMATION="$API/auth/v1/verify" \
    -e GOTRUE_MAILER_URLPATHS_RECOVERY="$API/auth/v1/verify" \
    -e GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE="$API/auth/v1/verify" \
    -e GOTRUE_DB_DRIVER=postgres \
    -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$POSTGRES_PASSWORD@ue-stage-db:5432/postgres" \
    -e GOTRUE_SITE_URL="$SITE" \
    -e GOTRUE_URI_ALLOW_LIST="$SITE/change-password.html" \
    -e GOTRUE_DISABLE_SIGNUP=true \
    -e GOTRUE_JWT_SECRET="$JWT_SECRET" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated \
    -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
    -e GOTRUE_EXTERNAL_PHONE_ENABLED=false \
    -e GOTRUE_MAILER_OTP_EXP="${1:-3600}" \
    -e GOTRUE_PASSWORD_MIN_LENGTH=12 \
    -e "GOTRUE_PASSWORD_REQUIRED_CHARACTERS=abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!#\$%&*+-=?@_" \
    -e GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION="${UE_SECURE_PASSWORD_CHANGE:-false}" \
    -e GOTRUE_RATE_LIMIT_VERIFY=1000 -e GOTRUE_RATE_LIMIT_TOKEN_REFRESH=1000 \
    "$AUTH_IMAGE" >/dev/null
  wait_for auth probe http://ue-stage-auth:9999/health
}

up() {
  load_env
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create --label "$LABEL" "$NET" >/dev/null

  log "database"
  docker run -d --name ue-stage-db --label "$LABEL" --network "$NET" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" -e JWT_SECRET="$JWT_SECRET" -e JWT_EXP=3600 \
    "$PG_IMAGE" >/dev/null
  wait_for database docker exec ue-stage-db pg_isready -U postgres -h localhost
  # Service roles have no password in the plain image (the CLI sets them); use the generated one.
  db_target_check
  printf "alter role authenticator password :'pw';\nalter role supabase_auth_admin password :'pw';\nalter role supabase_storage_admin password :'pw';\n" |
    docker exec -i ue-stage-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 -v pw="$POSTGRES_PASSWORD" >/dev/null

  log "gateway (127.0.0.1:54321 only)"
  docker run -d --name ue-stage-gateway --label "$LABEL" --network "$NET" \
    -p 127.0.0.1:54321:8000 -v "$HERE/nginx.conf:/etc/nginx/nginx.conf:ro" "$GATEWAY_IMAGE" >/dev/null

  start_auth

  log "storage (runs its own migrations)"
  docker run -d --name ue-stage-storage --label "$LABEL" --network "$NET" \
    -e ANON_KEY="$ANON_KEY" -e SERVICE_KEY="$SERVICE_ROLE_KEY" \
    -e AUTH_JWT_SECRET="$JWT_SECRET" -e AUTH_JWT_ALGORITHM=HS256 -e PGRST_JWT_SECRET="$JWT_SECRET" \
    -e DATABASE_URL="postgres://supabase_storage_admin:$POSTGRES_PASSWORD@ue-stage-db:5432/postgres" \
    -e POSTGREST_URL=http://ue-stage-rest:3000 \
    -e FILE_SIZE_LIMIT=52428800 -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
    -e TENANT_ID=stub -e REGION=local -e STORAGE_S3_REGION=local -e GLOBAL_S3_BUCKET=stub \
    -e ENABLE_IMAGE_TRANSFORMATION=false -e DB_INSTALL_ROLES=false \
    "$STORAGE_IMAGE" >/dev/null
  wait_for storage probe http://ue-stage-storage:5000/status

  log "production schema (schema-only backup) + platform objects"
  copy_in "$BACKUP_DIR/roles.sql" /tmp/roles.sql
  copy_in "$BACKUP_DIR/schema.sql" /tmp/schema.sql
  copy_in "$BACKUP_DIR/platform_objects.v2.sql" /tmp/platform_objects.sql
  db_target_check
  docker exec ue-stage-db psql -U supabase_admin -d postgres -X -q -f /tmp/roles.sql >/dev/null 2>&1 || true   # 1 known error: supabase_realtime_admin
  psql_file /tmp/schema.sql
  psql_file /tmp/platform_objects.sql
  # Remove the EXECUTE grants that the restore adds but production does not have
  # (supabase/tests/replica_alignment.sql), so tests start from production's real privileges.
  copy_in "$REPO/supabase/tests/replica_alignment.sql" /tmp/replica_alignment.sql
  db_target_check
  docker exec -e PGOPTIONS="-c client_min_messages=warning -c ue.replica_alignment=local-only" ue-stage-db \
    psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/replica_alignment.sql
  copy_in "$REPO/supabase/faculties_seed.sql" /tmp/faculties_seed.sql
  copy_in "$HERE/seed.sql" /tmp/seed.sql
  psql_file /tmp/faculties_seed.sql
  psql_file /tmp/seed.sql

  log "pending migrations"
  for m in $(node -e 'import("file:///'"$REPO"'/scripts/lib/pending-migrations.mjs").then(m => console.log(m.PENDING.join(" ")))'); do
    copy_in "$REPO/supabase/migrations/$m.sql" "/tmp/$m.sql"
    psql_file "/tmp/$m.sql" postgres
    log "  applied $m"
  done

  log "rest (PostgREST)"
  docker run -d --name ue-stage-rest --label "$LABEL" --network "$NET" \
    -e PGRST_DB_URI="postgres://authenticator:$POSTGRES_PASSWORD@ue-stage-db:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
    -e PGRST_JWT_SECRET="$JWT_SECRET" -e PGRST_DB_USE_LEGACY_GUCS=false \
    -e PGRST_APP_SETTINGS_JWT_SECRET="$JWT_SECRET" -e PGRST_APP_SETTINGS_JWT_EXP=3600 \
    "$REST_IMAGE" >/dev/null
  wait_for rest probe http://ue-stage-rest:3000/

  log "functions (edge-runtime; repository functions mounted read-only)"
  docker run -d --name ue-stage-functions --label "$LABEL" --network "$NET" \
    -v "$REPO/supabase/functions:/home/deno/functions:ro" \
    -v "$HERE/functions-main:/home/deno/main:ro" \
    -e JWT_SECRET="$JWT_SECRET" \
    -e SUPABASE_URL=http://ue-stage-gateway:8000 \
    -e SUPABASE_ANON_KEY="$ANON_KEY" -e SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
    -e PUBLIC_SITE_URL="${UE_PUBLIC_SITE_URL-$SITE}" \
    "$EDGE_IMAGE" start --main-service /home/deno/main -p 9000 >/dev/null
  wait_for functions probe_any http://ue-stage-functions:9000/

  build_site
  status
}

# The exact Vercel artifact (scripts/build-public.mjs -> public/), with js/config.js
# pointing at the local stack (the committed config, which targets production, is
# never modified).
build_site() {
  load_env
  ( cd "$REPO" && node scripts/build-public.mjs ) || { echo "site build failed" >&2; exit 1; }
  rm -rf "$HERE/.build/web"; mkdir -p "$HERE/.build"
  cp -r "$REPO/public" "$HERE/.build/web"
  cat > "$HERE/.build/web/js/config.js" <<EOF
// LOCAL STAGING BUILD — generated by staging-local/stack.sh. Not for deployment.
window.UE_CONFIG = { SUPABASE_URL: "$API", SUPABASE_ANON_KEY: "$ANON_KEY" };
window.UE_AUTH_REDIRECT = { hash: location.hash, search: location.search };
window.sb = window.supabase.createClient(window.UE_CONFIG.SUPABASE_URL, window.UE_CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "ueclubiste-auth" }
});
EOF
  log "site build ready in staging-local/.build/web (serve on 127.0.0.1:5500)"
}

status() {
  docker ps -a --filter "label=ue-stage=local" --format '{{.Names}}\t{{.Status}}\tports={{.Ports}}'
}

down() {
  docker ps -aq --filter "label=ue-stage=local" | xargs -r docker rm -f >/dev/null
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$HERE/.build"
  [ "${1:-}" = "--purge" ] && rm -rf "$HERE/.secrets"
  log "removed (images kept; --purge also deletes the generated keys)"
}

case "${1:-}" in
  up) up ;;
  status) status ;;
  down) shift; down "${1:-}" ;;
  build-site) build_site ;;
  auth) shift; start_auth "${1:-3600}" ;;
  *) echo "usage: $0 up|status|down [--purge]|build-site" >&2; exit 2 ;;
esac
