#!/usr/bin/env bash
# The A5 smoke test (ADR 0002): real Caddy, a standalone Authelia and the real app image in authelia mode, driven
# with curl. It exits 0 only when every assertion holds. Nothing here touches a real server, a real domain or a real
# secret: every password and key is random and lives under deploy/smoke/.run, which is deleted on exit.
#
#   bash deploy/smoke/run.sh
#
# Environment:
#   SMOKE_PROJECT    Compose project name. Default cbs-a5.
#   SMOKE_PORT       Host port for Caddy's HTTPS listener, on 127.0.0.1. Default 8143. Never 80, 443 or 3000.
#   SMOKE_APP_IMAGE  An app image to test as it is. Without it, the run builds cbs-smoke-app:local from the Dockerfile's runner stage.
#   SMOKE_KEEP       Set to 1 to leave the stack up afterwards. Tear it down with
#                    docker compose -p <project> -f deploy/smoke/compose.yml down -v
#   SMOKE_MUTATE     Breaks one guarantee on purpose, to prove the matching assertions go red:
#                      no-strip   Caddy stops deleting Remote-* headers.
#                      no-secret  Caddy stops adding X-CBS-Proxy-Secret.
#                      no-copy    forward_auth stops copying Authelia's identity onto the request.
#                    Breaking the app's own secret check needs a different image: build one from patched
#                    source and pass it as SMOKE_APP_IMAGE.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PROJECT="${SMOKE_PROJECT:-cbs-a5}"
PORT="${SMOKE_PORT:-8143}"
RUN="$HERE/.run"
APP_IMAGE="${SMOKE_APP_IMAGE:-cbs-smoke-app:local}"
BUILD_APP=1; [ -z "${SMOKE_APP_IMAGE:-}" ] || BUILD_APP=0
MUTATE="${SMOKE_MUTATE:-}"
AUTHELIA_IMAGE="authelia/authelia:4.39"
CADDY_IMAGE="caddy:2.10-alpine"

[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "SMOKE_PORT must be a number" >&2; exit 2; }
case "$PORT" in 80 | 443 | 3000) echo "refusing port $PORT" >&2; exit 2 ;; esac
case "$MUTATE" in "" | no-strip | no-secret | no-copy) ;; *) echo "unknown SMOKE_MUTATE: $MUTATE" >&2; exit 2 ;; esac
command -v docker > /dev/null || { echo "docker is required" >&2; exit 2; }
command -v curl > /dev/null || { echo "curl is required" >&2; exit 2; }
command -v node > /dev/null || { echo "node is required (it parses the JSON the checks read)" >&2; exit 2; }

export MSYS_NO_PATHCONV=1
hostpath() { if command -v cygpath > /dev/null; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

C=(docker compose -p "$PROJECT" -f "$(hostpath "$HERE/compose.yml")")
WORK="$(hostpath "$(mktemp -d)")"
checks=0
failures=0

teardown() {
  local status=$?
  if [ "$failures" -gt 0 ] || [ "$status" -ne 0 ]; then
    for service in caddy authelia app-production; do
      echo "--- $service (last lines) ---"; "${C[@]}" logs --no-color --tail 25 "$service" 2>&1 || true
    done
  fi
  if [ "${SMOKE_KEEP:-}" != 1 ]; then
    docker compose -p "$PROJECT" down -v --remove-orphans > /dev/null 2>&1 || true
    rm -rf "$RUN"
  fi
  rm -rf "$WORK"
}
trap teardown EXIT

step() { printf '\n== %s\n' "$1"; }
pass() { checks=$((checks + 1)); printf '  ok    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  FAIL  %s\n' "$1"; }
assert_eq() { if [ "$1" = "$2" ]; then pass "$3"; else fail "$3 (expected '$2', got '$1')"; fi; }
assert_ne() { if [ "$1" != "$2" ]; then pass "$3"; else fail "$3 (got '$1')"; fi; }
assert_match() { if [[ "$1" =~ $2 ]]; then pass "$3"; else fail "$3 (expected /$2/, got '$1')"; fi; }
assert_empty() { if [ -z "$1" ]; then pass "$2"; else fail "$2 (got '$1')"; fi; }
assert_nonzero() { if [ "$1" -ne 0 ]; then pass "$2"; else fail "$2 (exit was 0)"; fi; }

random_hex() { openssl rand -hex "$1"; }
# Runs a noisy command and shows its output only when it fails.
quiet() { "$@" > "$WORK/quiet.log" 2>&1 || { cat "$WORK/quiet.log" >&2; return 1; }; }
quiet_stdin() { local input="$1"; shift; "$@" < "$input" > "$WORK/quiet.log" 2>&1 || { cat "$WORK/quiet.log" >&2; return 1; }; }

# --- Preparation ------------------------------------------------------------------------------------------------

step "generate throwaway secrets and render the configuration"
docker compose -p "$PROJECT" down -v --remove-orphans > /dev/null 2>&1 || true
rm -rf "$RUN"; mkdir -p "$RUN/authelia" "$RUN/users" "$RUN/state" "$RUN/caddy"

export SMOKE_PORT="$PORT" SMOKE_APP_IMAGE="$APP_IMAGE"
SMOKE_PG_PASSWORD="$(random_hex 12)"; SMOKE_OWNER_PASSWORD="$(random_hex 12)"
SMOKE_APP_PASSWORD="$(random_hex 12)"; SMOKE_PLATFORM_PASSWORD="$(random_hex 12)"
SMOKE_PRODUCTION_SECRET="$(random_hex 32)"; SMOKE_STAGING_SECRET="$(random_hex 32)"
SMOKE_AUTHELIA_JWT="$(random_hex 32)"; SMOKE_AUTHELIA_SESSION="$(random_hex 32)"; SMOKE_AUTHELIA_STORAGE="$(random_hex 32)"
export SMOKE_PG_PASSWORD SMOKE_OWNER_PASSWORD SMOKE_APP_PASSWORD SMOKE_PLATFORM_PASSWORD SMOKE_PRODUCTION_SECRET SMOKE_STAGING_SECRET \
  SMOKE_AUTHELIA_JWT SMOKE_AUTHELIA_SESSION SMOKE_AUTHELIA_STORAGE

# The real snippets, with example.com swapped for the smoke domains. The portal URL gains the port.
render_snippet() {
  sed -e "s#https://auth\.billing-staging\.example\.com#https://auth.cbs-staging.smoke.test:$PORT#g" \
    -e "s#https://auth\.billing\.example\.com#https://auth.cbs.smoke.test:$PORT#g" \
    -e 's#billing-staging\.example\.com#cbs-staging.smoke.test#g' \
    -e 's#billing\.example\.com#cbs.smoke.test#g' "$1" > "$2"
}
cp "$HERE/authelia/configuration.yml" "$RUN/authelia/configuration.yml"
render_snippet "$REPO/deploy/authelia/cbs-session-cookies.yml" "$RUN/authelia/cbs-session-cookies.yml"
render_snippet "$REPO/deploy/authelia/cbs-access-control.yml" "$RUN/authelia/cbs-access-control.yml"
cp "$REPO/deploy/caddy/cbs.caddy" "$RUN/caddy/cbs.caddy"
case "$MUTATE" in
  no-strip) sed -i '/request_header -Remote-\*/d' "$RUN/caddy/cbs.caddy" ;;
  no-secret) sed -i '/request_header X-CBS-Proxy-Secret/d' "$RUN/caddy/cbs.caddy" ;;
  no-copy) sed -i '/copy_headers/d' "$RUN/caddy/cbs.caddy" ;;
esac
[ -z "$MUTATE" ] || printf '  MUTATION ACTIVE: %s. This run is expected to fail.\n' "$MUTATE"

# The fixture users come from the A6 script. Authelia is not running yet, so the digests come from a throwaway container.
printf 'users: {}\n' > "$RUN/users/users_database.yml"
export AUTHELIA_USERS_FILE="$RUN/users/users_database.yml"
export AUTHELIA_HASH_CMD="docker run --rm $AUTHELIA_IMAGE authelia crypto hash generate argon2 --random --random.length 24 --random.charset alphanumeric"
add_fixture_user() { "$REPO/deploy/authelia-user.sh" add "$@" 2> /dev/null | sed -n 's/^password: //p'; }
ALICE_PASSWORD="$(add_fixture_user alice alice@smoke.test 'Alice Smoke' cbs-users,cbs-staging-users)"
CAROL_PASSWORD="$(add_fixture_user carol carol@smoke.test 'Carol Elsewhere' cwerp-users)"
ROOT_PASSWORD="$(add_fixture_user root root@smoke.test 'Root Admin' cbs-superadmin)"
unset AUTHELIA_HASH_CMD

# --- Static checks ----------------------------------------------------------------------------------------------

step "static validation"
caddy_validate() {
  docker run --rm -v "$(hostpath "$1"):/etc/caddy:ro" -e STAGING_DOMAIN="$2" -e PRODUCTION_DOMAIN="$3" -e STAGING_PROXY_SECRET=x -e PRODUCTION_PROXY_SECRET=x \
    "$CADDY_IMAGE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > "$WORK/caddy-validate.log" 2>&1
}
caddy_validate "$REPO/deploy" billing-staging.example.com billing.example.com && pass "caddy validate: deploy/Caddyfile importing the snippet" || { cat "$WORK/caddy-validate.log"; fail "caddy validate: deploy/Caddyfile"; }

authelia_validate() {
  docker run --rm -v "$(hostpath "$1"):/config:ro" -v "$(hostpath "$RUN/users"):/users:ro" \
    -e AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET="$SMOKE_AUTHELIA_JWT" -e AUTHELIA_SESSION_SECRET="$SMOKE_AUTHELIA_SESSION" -e AUTHELIA_STORAGE_ENCRYPTION_KEY="$SMOKE_AUTHELIA_STORAGE" \
    "$AUTHELIA_IMAGE" authelia validate-config --config /config/configuration.yml --config /config/cbs-session-cookies.yml --config /config/cbs-access-control.yml > "$WORK/authelia-validate.log" 2>&1
}
authelia_validate "$RUN/authelia" && pass "authelia validate-config: smoke configuration with the snippets merged (smoke domains)" || { cat "$WORK/authelia-validate.log"; fail "authelia validate-config (smoke domains)"; }
mkdir -p "$WORK/raw"
cp "$HERE/authelia/configuration.yml" "$WORK/raw/configuration.yml"
cp "$REPO/deploy/authelia/cbs-session-cookies.yml" "$REPO/deploy/authelia/cbs-access-control.yml" "$WORK/raw/"
authelia_validate "$WORK/raw" && pass "authelia validate-config: the snippets exactly as shipped (example.com)" || { cat "$WORK/authelia-validate.log"; fail "authelia validate-config (snippets as shipped)"; }

# --- Bring-up ---------------------------------------------------------------------------------------------------

step "build, start Postgres, create roles, migrate, seed"
[ "$BUILD_APP" = 0 ] || quiet "${C[@]}" build app-production
quiet "${C[@]}" --profile migrate build migrator
quiet "${C[@]}" up -d --wait db
quiet_stdin "$REPO/db/roles.sql" "${C[@]}" exec -T db psql -v ON_ERROR_STOP=1 -q -U postgres -d cbs \
  -v owner_password="$SMOKE_OWNER_PASSWORD" -v app_password="$SMOKE_APP_PASSWORD" -v platform_password="$SMOKE_PLATFORM_PASSWORD"
quiet "${C[@]}" --profile migrate run --rm --no-deps -T migrator
quiet "${C[@]}" --profile migrate run --rm --no-deps -T migrator node db/seed/demo.ts
assert_eq "$("${C[@]}" exec -T db psql -U postgres -d cbs -Atc 'SELECT count(*) FROM tenants')" 5 "the migrated database holds the five seeded tenants"

step "start Authelia, the app and Caddy"
quiet "${C[@]}" up -d --wait
APP_ID="$("${C[@]}" ps -q app-production)"
AUTHELIA_ID="$("${C[@]}" ps -q authelia)"
ORIGIN="https://cbs.smoke.test:$PORT"
PORTAL="https://auth.cbs.smoke.test:$PORT"
STAGING="https://cbs-staging.smoke.test:$PORT"
STAGING_PORTAL="https://auth.cbs-staging.smoke.test:$PORT"
RESOLVE=()
for host in cbs.smoke.test auth.cbs.smoke.test cbs-staging.smoke.test auth.cbs-staging.smoke.test; do RESOLVE+=(--resolve "$host:$PORT:127.0.0.1"); done

# --- Helpers ----------------------------------------------------------------------------------------------------

# req <jar|-> <method> <url> [curl args...]. Sets HTTP_STATUS, HTTP_LOCATION and HTTP_BODY. The jar is read and written.
req() {
  local jar="$1" method="$2" url="$3"; shift 3
  local -a jar_args=()
  [ "$jar" = - ] || jar_args=(-b "$jar" -c "$jar")
  HTTP_STATUS="$(curl -sS -k --max-time 30 "${RESOLVE[@]}" "${jar_args[@]}" -X "$method" -D "$WORK/headers" -o "$WORK/body" -w '%{http_code}' "$@" "$url" 2> /dev/null)" || HTTP_STATUS=000
  HTTP_BODY="$(cat "$WORK/body" 2> /dev/null || true)"
  HTTP_LOCATION="$(tr -d '\r' < "$WORK/headers" | sed -n 's/^[Ll]ocation: //p' | head -n 1)"
}

# direct <curl args...>: a request from the edge network, where Caddy sits. Sets DIRECT_STATUS and DIRECT_BODY.
direct() {
  local out
  out="$("${C[@]}" exec -T probe curl -sS --max-time 10 -w '\n%{http_code}' "$@" 2> /dev/null)" || out=$'\n000'
  DIRECT_STATUS="${out##*$'\n'}"
  DIRECT_BODY="${out%$'\n'*}"
}

# jget <json> <dotted.path>: prints the value, arrays comma-joined, or nothing.
jget() {
  node -e 'let v; try { v = process.argv[1] === "" ? undefined : JSON.parse(process.argv[1]); for (const k of process.argv[2].split(".")) v = v == null ? v : v[k]; } catch { v = undefined }
    process.stdout.write(v === undefined || v === null ? "" : Array.isArray(v) ? v.join(",") : String(v))' "$1" "$2"
}

# signin <jar> <portal url> <user> <password>: Authelia's first-factor API. Sets HTTP_STATUS.
signin() {
  local body
  body="$(node -e 'process.stdout.write(JSON.stringify({ username: process.argv[1], password: process.argv[2], keepMeLoggedIn: false }))' "$3" "$4")"
  req "$1" POST "$2/api/firstfactor" -H 'Content-Type: application/json' --data "$body"
}

# wait_for_signin <expected status> <user> <password>: Authelia re-reads the users file on change, so poll briefly.
# A few tries only: every failed sign-in counts toward Authelia's lockout.
wait_for_signin() {
  local want="$1" user="$2" password="$3" attempt
  for attempt in 1 2 3 4; do
    signin - "$PORTAL" "$user" "$password"
    [ "$HTTP_STATUS" = "$want" ] && return 0
    sleep 1
  done
  return 1
}

AS_ALICE="$WORK/alice.jar"; AS_ALICE_STAGING="$WORK/alice-staging.jar"; AS_CAROL="$WORK/carol.jar"; AS_ROOT="$WORK/root.jar"
SECRET_ENV="$SMOKE_PRODUCTION_SECRET"

# --- Assertions -------------------------------------------------------------------------------------------------

step "unauthenticated requests are sent to the portal"
req - GET "$ORIGIN/"
assert_eq "$HTTP_STATUS" 302 "GET / without a session gets 302"
assert_match "$HTTP_LOCATION" "^$PORTAL/\?rd=https%3A%2F%2Fcbs\.smoke\.test%3A$PORT%2F" "the 302 goes to the portal with rd"
req - GET "$ORIGIN/" -H 'Remote-User: admin' -H 'Remote-Groups: cbs-superadmin' -H 'Remote-Email: admin@smoke.test'
assert_eq "$HTTP_STATUS" 302 "a request that forges Remote-User: admin still gets 302"
req - GET "$ORIGIN/api/auth/me" -H 'Remote-User: admin' -H 'Remote-Groups: cbs-superadmin' -H "X-CBS-Proxy-Secret: $SECRET_ENV"
assert_eq "$HTTP_STATUS" 302 "forging both the identity and the secret in front of Caddy still gets 302"
req - GET "$ORIGIN/api/health"
assert_eq "$HTTP_STATUS" 302 "/api/health through Caddy needs a session too"
req - GET "$ORIGIN/" -H 'X-Requested-With: XMLHttpRequest'
assert_eq "$HTTP_STATUS" 401 "an XHR without a session gets 401, which api-client.ts treats as expired"

step "sign in as alice through Authelia's first-factor API"
signin "$AS_ALICE" "$PORTAL" alice "$ALICE_PASSWORD"
assert_eq "$HTTP_STATUS" 200 "POST /api/firstfactor returns 200"
assert_eq "$(jget "$HTTP_BODY" status)" OK "the first-factor body says OK"
cookie_line="$(grep -i 'cbs_session' "$WORK/headers" | tr -d '\r' | head -n 1)"
assert_match "$cookie_line" 'cbs_session=' "the session cookie is named cbs_session"
assert_match "$cookie_line" '[Dd]omain=cbs\.smoke\.test' "the cookie is scoped to the site's domain"
assert_match "$cookie_line" '[Hh]ttp[Oo]nly' "the cookie is HttpOnly"
assert_match "$cookie_line" '[Ss]ecure' "the cookie is Secure"
assert_match "$cookie_line" '[Ss]ame[Ss]ite=[Ll]ax' "the cookie is SameSite=Lax"
cp "$AS_ALICE" "$WORK/alice-before-logout.jar"

step "(a) the app trusts Remote-* only through Caddy's secret"
req "$AS_ALICE" GET "$ORIGIN/api/auth/me"
assert_eq "$HTTP_STATUS" 200 "alice's /api/auth/me returns 200"
assert_eq "$(jget "$HTTP_BODY" identity.username)" alice "the username is alice"
assert_eq "$(jget "$HTTP_BODY" identity.email)" alice@smoke.test "the email is alice's"
assert_eq "$(jget "$HTTP_BODY" principal)" member "a member-group user resolves to member"
assert_match "$(jget "$HTTP_BODY" identity.groups)" 'cbs-users' "the groups come from Authelia"
req "$AS_ALICE" GET "$ORIGIN/api/health"
assert_eq "$HTTP_STATUS" 200 "/api/health through Caddy returns 200 once signed in"

good_secret=(-H "X-CBS-Proxy-Secret: $SMOKE_PRODUCTION_SECRET")
direct "${good_secret[@]}" -H 'Remote-User: zed' -H 'Remote-Groups: cbs-users' -H 'Remote-Email: zed@smoke.test' http://app-production:3000/api/auth/me
assert_eq "$DIRECT_STATUS" 200 "with the right secret, direct from the edge network, the app trusts Remote-*"
assert_eq "$(jget "$DIRECT_BODY" identity.username)" zed "the trusted username is the header's"
direct "${good_secret[@]}" -H 'Remote-User: zed' -H 'Remote-Groups: cbs-superadmin' http://app-production:3000/api/auth/me
assert_eq "$(jget "$DIRECT_BODY" principal)" platform "the superadmin group resolves to platform"
direct "${good_secret[@]}" -H 'Remote-User: zed' -H 'Remote-Groups: cwerp-users' http://app-production:3000/api/auth/me
assert_eq "$DIRECT_STATUS" 403 "with the right secret, a user outside both groups gets 403"
direct "${good_secret[@]}" http://app-production:3000/api/auth/me
assert_eq "$DIRECT_STATUS" 401 "with the right secret but no Remote-User, the app answers 401"
direct -H "X-CBS-Proxy-Secret: ${SMOKE_PRODUCTION_SECRET%?}x" -H 'Remote-User: zed' -H 'Remote-Groups: cbs-users' http://app-production:3000/api/auth/me
assert_eq "$DIRECT_STATUS" 401 "a same-length wrong secret is refused"
direct -H 'X-CBS-Proxy-Secret: short' -H 'Remote-User: zed' -H 'Remote-Groups: cbs-users' http://app-production:3000/api/auth/me
assert_eq "$DIRECT_STATUS" 401 "a different-length wrong secret is refused"
direct -H "X-CBS-Proxy-Secret: $SMOKE_STAGING_SECRET" -H 'Remote-User: zed' -H 'Remote-Groups: cbs-users' http://app-production:3000/api/auth/me
assert_eq "$DIRECT_STATUS" 401 "the staging environment's secret does not open production"

step "(b) forged Remote-* sent straight to the app, with no secret, is refused"
direct -H 'Remote-User: alice' -H 'Remote-Groups: cbs-users' -H 'Remote-Email: alice@smoke.test' http://app-production:3000/api/auth/me
assert_eq "$DIRECT_STATUS" 401 "forged member headers get 401"
direct -H 'Remote-User: root' -H 'Remote-Groups: cbs-superadmin' http://app-production:3000/api/auth/me
assert_eq "$DIRECT_STATUS" 401 "forged superadmin headers get 401"
direct -H 'Remote-User: root' -H 'Remote-Groups: cbs-superadmin' http://app-production:3000/api/v1/ping
assert_eq "$DIRECT_STATUS" 401 "forged headers to /api/v1/ping get 401 too"
direct http://app-production:3000/api/health
assert_eq "$DIRECT_STATUS" 200 "/api/health answers without a secret, for the container health check"

step "(c) Caddy strips what a client sends and replaces it"
req "$AS_ALICE" GET "$ORIGIN/api/auth/me" -H 'Remote-User: bob' -H 'Remote-Email: bob@smoke.test' -H 'Remote-Groups: cbs-superadmin' -H 'Remote-Name: Bob' -H 'X-CBS-Proxy-Secret: forged'
assert_eq "$HTTP_STATUS" 200 "signed in as alice, a request with forged headers still reaches the app"
assert_eq "$(jget "$HTTP_BODY" identity.username)" alice "forged Remote-User: bob still yields alice"
assert_eq "$(jget "$HTTP_BODY" identity.email)" alice@smoke.test "forged Remote-Email is replaced"
assert_eq "$(jget "$HTTP_BODY" principal)" member "forged Remote-Groups: cbs-superadmin does not make alice a platform user"
signin "$AS_ALICE_STAGING" "$STAGING_PORTAL" alice "$ALICE_PASSWORD"
assert_eq "$HTTP_STATUS" 200 "alice signs in to the staging portal too"
req "$AS_ALICE_STAGING" GET "$STAGING/anything" -H 'Remote-User: bob' -H 'Remote-Groups: cbs-staging-superadmin' -H 'Remote-Foo: x' -H 'X-CBS-Proxy-Secret: forged'
assert_eq "$HTTP_STATUS" 200 "the stand-in upstream answers a signed-in request"
assert_eq "$(jget "$HTTP_BODY" headers.remote-user)" alice "the upstream sees Authelia's Remote-User, not the forged one"
assert_eq "$(jget "$HTTP_BODY" headers.remote-email)" alice@smoke.test "the upstream sees Authelia's Remote-Email"
assert_match "$(jget "$HTTP_BODY" headers.remote-groups)" '^cbs-users,cbs-staging-users$|^cbs-staging-users,cbs-users$' "the upstream sees Authelia's groups, not the forged ones"
assert_empty "$(jget "$HTTP_BODY" headers.remote-foo)" "a made-up Remote-Foo header does not reach the upstream"
assert_eq "$(jget "$HTTP_BODY" headers.x-cbs-proxy-secret)" "$SMOKE_STAGING_SECRET" "the upstream sees Caddy's secret, not the forged one"
assert_eq "$(jget "$HTTP_BODY" headers.cookie)" "cbs_session=_Value_Hidden." "the session cookie is replaced with a dummy on the hop to the upstream"
req - GET "$STAGING/api/v1/anything" -H 'Remote-User: admin' -H 'Remote-Groups: cbs-staging-superadmin' -H 'Remote-Foo: x' -H 'X-CBS-Proxy-Secret: forged'
assert_eq "$HTTP_STATUS" 200 "/api/v1/* skips Authelia"
assert_empty "$(jget "$HTTP_BODY" headers.remote-user)" "a forged Remote-User on the machine route is stripped"
assert_empty "$(jget "$HTTP_BODY" headers.remote-groups)" "a forged Remote-Groups on the machine route is stripped"
assert_empty "$(jget "$HTTP_BODY" headers.remote-foo)" "any Remote-* name is stripped on the machine route"
assert_eq "$(jget "$HTTP_BODY" headers.x-cbs-proxy-secret)" "$SMOKE_STAGING_SECRET" "the machine route carries Caddy's secret, not the forged one"
req - GET "$ORIGIN/api/v1/ping" -H 'Remote-User: admin' -H 'Remote-Groups: cbs-superadmin'
assert_eq "$HTTP_STATUS" 200 "/api/v1/ping reaches the app without an Authelia session"
assert_eq "$(jget "$HTTP_BODY" ok)" true "the app answered"
assert_empty "$(jget "$HTTP_BODY" remoteUser)" "a forged Remote-User sent to /api/v1/ping is absent in the app"

step "network isolation"
published="$("${C[@]}" port app-production 3000 2> /dev/null || true)"
if [[ "$published" =~ ^[0-9.]+:[0-9]+$ ]] && [ "${published##*:}" != 0 ]; then fail "docker compose port app-production 3000 reports a host port ($published)"; else pass "docker compose port app-production 3000 reports no host port (prints '${published}')"; fi
assert_empty "$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$APP_ID" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);process.stdout.write(Object.values(p).some(Boolean)?s:"")})')" "the app container publishes no host port"
assert_eq "$("${C[@]}" port caddy "$PORT")" "127.0.0.1:$PORT" "only Caddy publishes a port, on 127.0.0.1"
APP_EDGE_IP="$(docker inspect -f '{{range $name, $net := .NetworkSettings.Networks}}{{if eq $name "'"$PROJECT"'_edge"}}{{$net.IPAddress}}{{end}}{{end}}' "$APP_ID")"
assert_match "$APP_EDGE_IP" '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' "the app has an address on the edge network"
rc=0; "${C[@]}" exec -T outsider curl -sS --max-time 4 http://app-production:3000/api/health > /dev/null 2>&1 || rc=$?
assert_nonzero "$rc" "a container on another network cannot resolve the app by name"
rc=0; "${C[@]}" exec -T outsider curl -sS --max-time 4 "http://$APP_EDGE_IP:3000/api/health" > /dev/null 2>&1 || rc=$?
assert_nonzero "$rc" "a container on another network cannot connect to the app's edge address"
direct http://db:5432/
assert_eq "$DIRECT_STATUS" 000 "the edge network cannot reach the database"

step "authorisation by group"
signin "$AS_CAROL" "$PORTAL" carol "$CAROL_PASSWORD"
assert_eq "$HTTP_STATUS" 200 "carol, who belongs to another app, can sign in to Authelia"
req "$AS_CAROL" GET "$ORIGIN/api/auth/me"
assert_eq "$HTTP_STATUS" 403 "carol is denied at the gate (default_policy deny)"
signin "$AS_ROOT" "$PORTAL" root "$ROOT_PASSWORD"
assert_eq "$HTTP_STATUS" 200 "root's first factor succeeds"
req "$AS_ROOT" GET "$ORIGIN/api/auth/me"
assert_ne "$HTTP_STATUS" 200 "a superadmin with one factor only does not reach the app (two_factor rule)"
assert_match "$HTTP_STATUS" '^(302|401|403)$' "the superadmin without TOTP is turned away at the gate"

step "(d) sign-out"
req "$AS_ALICE" POST "$PORTAL/api/logout" -H 'Content-Type: application/json' --data '{}'
assert_eq "$HTTP_STATUS" 200 "POST /api/logout on the portal returns 200"
req "$AS_ALICE" GET "$ORIGIN/api/auth/me"
assert_eq "$HTTP_STATUS" 302 "after sign-out the same cookie jar is sent to the portal"
req "$WORK/alice-before-logout.jar" GET "$ORIGIN/api/auth/me"
assert_eq "$HTTP_STATUS" 302 "replaying the cookie from before sign-out also fails: the session is gone on the server"
req "$AS_ALICE_STAGING" GET "$STAGING/anything"
assert_eq "$HTTP_STATUS" 200 "signing out of one site does not end the sibling site's session (separate cookies)"

step "A6: the operator script against the running stack"
export AUTHELIA_USERS_FILE="$RUN/users/users_database.yml" AUTHELIA_CONTAINER="$AUTHELIA_ID"
# Docker Desktop does not pass host-side file events into a container, so there the reload nudge runs inside it.
if [ "$(uname -s)" != Linux ]; then
  export AUTHELIA_RELOAD_CMD="docker exec $AUTHELIA_ID sh -c 'dd if=/users/users_database.yml of=/users/users_database.yml bs=1048576 conv=notrunc'"
fi
DAVE_PASSWORD="$("$REPO/deploy/authelia-user.sh" add dave dave@smoke.test 'Dave Added' cbs-users | sed -n 's/^password: //p')"
assert_ne "$DAVE_PASSWORD" "" "add prints a password once"
wait_for_signin 200 dave "$DAVE_PASSWORD" && pass "a user added with the script can sign in without restarting Authelia" || fail "dave cannot sign in after add"
signin "$WORK/dave.jar" "$PORTAL" dave "$DAVE_PASSWORD"
req "$WORK/dave.jar" GET "$ORIGIN/api/auth/me"
assert_eq "$(jget "$HTTP_BODY" identity.username)" dave "the new user reaches the app as dave"
assert_empty "$(grep -c "$DAVE_PASSWORD" "$AUTHELIA_USERS_FILE" | grep -v '^0$' || true)" "the plain password is not in the users file"
before="$WORK/users-before"; cp "$AUTHELIA_USERS_FILE" "$before"
rc=0; "$REPO/deploy/authelia-user.sh" add dave2 DAVE@smoke.test 'Dave Again' cbs-users > /dev/null 2>&1 || rc=$?
assert_nonzero "$rc" "add refuses an email already in the file, case-insensitively"
cmp -s "$before" "$AUTHELIA_USERS_FILE" && pass "the refused add left the users file unchanged" || fail "the refused add changed the users file"
rc=0; "$REPO/deploy/authelia-user.sh" add dave other@smoke.test 'Dave Twice' cbs-users > /dev/null 2>&1 || rc=$?
assert_nonzero "$rc" "add twice for one username exits non-zero"
cmp -s "$before" "$AUTHELIA_USERS_FILE" && pass "the second add left the users file unchanged" || fail "the second add changed the users file"
"$REPO/deploy/authelia-user.sh" disable dave > /dev/null 2>&1
wait_for_signin 401 dave "$DAVE_PASSWORD" && pass "disable makes the user's next sign-in fail" || fail "dave can still sign in after disable"
ERIN_PASSWORD="$("$REPO/deploy/authelia-user.sh" add erin erin@smoke.test 'Erin Reset' cbs-users | sed -n 's/^password: //p')"
wait_for_signin 200 erin "$ERIN_PASSWORD" && pass "erin signs in with her first password" || fail "erin cannot sign in after add"
NEW_ERIN_PASSWORD="$("$REPO/deploy/authelia-user.sh" reset erin | sed -n 's/^password: //p')"
wait_for_signin 401 erin "$ERIN_PASSWORD" && pass "reset makes the old password fail" || fail "the old password still works after reset"
wait_for_signin 200 erin "$NEW_ERIN_PASSWORD" && pass "reset makes the new password work" || fail "the new password does not work"
assert_match "$("$REPO/deploy/authelia-user.sh" list)" 'alice +alice@smoke.test +active' "list shows the fixture users"

step "result"
if [ "$failures" -eq 0 ]; then printf '\nsmoke: %s checks passed\n' "$checks"; else printf '\nsmoke: %s of %s checks FAILED\n' "$failures" "$checks"; exit 1; fi
