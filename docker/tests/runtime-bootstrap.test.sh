#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
bootstrap_script="$repository_root/docker/runtime-bootstrap.sh"
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/defy-runtime-bootstrap-test.XXXXXX")
postgres_root="$fixture_root/postgres"
backend_root="$fixture_root/backend"
state_root="$fixture_root/state"

cleanup() {
  rm -rf "$fixture_root"
}

fail() {
  echo "runtime-bootstrap test failed: $1" >&2
  exit 1
}

file_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
    return
  fi

  stat -c '%a' "$1"
}

snapshot() {
  find "$postgres_root/current" "$backend_root/current" -type f -print | LC_ALL=C sort | while IFS= read -r file; do
    relative=${file#"$fixture_root"/}
    digest=$(openssl dgst -sha256 "$file" | awk '{print $NF}')
    printf '%s %s\n' "$relative" "$digest"
  done
}

trap cleanup EXIT HUP INT TERM
mkdir -p "$postgres_root" "$backend_root" "$state_root"

first_output=$(POSTGRES_SECRETS_ROOT="$postgres_root" BACKEND_SECRETS_ROOT="$backend_root" BOOTSTRAP_STATE_ROOT="$state_root" BACKEND_RUNTIME_GID="$(id -g)" sh "$bootstrap_script")

[ -d "$postgres_root/current" ] || fail 'PostgreSQL secret directory was not published'
[ -d "$backend_root/current" ] || fail 'backend secret directory was not published'
[ "$(file_mode "$postgres_root/current/password")" = '400' ] || fail 'database password permissions are not 0400'
[ "$(file_mode "$backend_root/current/database-url")" = '440' ] || fail 'backend secret permissions are not 0440'
[ "$(file_mode "$backend_root/current/server-key.pem")" = '440' ] || fail 'server key permissions are not 0440'
[ "$(file_mode "$backend_root/current/client-key.pem")" = '440' ] || fail 'client key permissions are not 0440'
[ "$(file_mode "$backend_root/current/ca-key.pem")" = '400' ] || fail 'CA key permissions are not 0400'

database_url=$(sed -n '1p' "$backend_root/current/database-url")
jwt_key=$(sed -n '1p' "$backend_root/current/jwt-key")
service_key=$(sed -n '1p' "$backend_root/current/service-api-key")
encryption_key=$(sed -n '1p' "$backend_root/current/trp-encryption-key")

case "$database_url" in
  postgres://defy:*@postgres:5432/defy_db) ;;
  *) fail 'generated DATABASE_URL has an unexpected shape' ;;
esac
[ "${#jwt_key}" -eq 128 ] || fail 'JWT key does not contain 64 random bytes'
[ "${#service_key}" -eq 64 ] || fail 'service key does not contain 32 random bytes'
[ "$(printf '%s' "$encryption_key" | openssl base64 -d -A | wc -c | tr -d ' ')" -eq 32 ] || fail 'encryption key does not decode to 32 bytes'

openssl verify -CAfile "$backend_root/current/ca-cert.pem" "$backend_root/current/server-cert.pem" "$backend_root/current/client-cert.pem" >/dev/null
server_certificate=$(openssl x509 -in "$backend_root/current/server-cert.pem" -noout -text)
printf '%s' "$server_certificate" | grep -F 'DNS:localhost' >/dev/null || fail 'server certificate lacks localhost SAN'
printf '%s' "$server_certificate" | grep -F 'DNS:trp.localhost' >/dev/null || fail 'server certificate lacks trp.localhost SAN'
printf '%s' "$server_certificate" | grep -F 'IP Address:127.0.0.1' >/dev/null || fail 'server certificate lacks loopback IP SAN'

before=$(snapshot)
second_output=$(POSTGRES_SECRETS_ROOT="$postgres_root" BACKEND_SECRETS_ROOT="$backend_root" BOOTSTRAP_STATE_ROOT="$state_root" BACKEND_RUNTIME_GID="$(id -g)" sh "$bootstrap_script")
after=$(snapshot)

[ "$before" = "$after" ] || fail 'a completed bootstrap was overwritten'
[ "$first_output" = 'Runtime bootstrap completed.' ] || fail 'first run emitted unexpected output'
[ "$second_output" = 'Runtime bootstrap already complete.' ] || fail 'idempotent run emitted unexpected output'
[ -z "$(find "$postgres_root" "$backend_root" -maxdepth 1 -name '.bootstrap.*' -print)" ] || fail 'temporary directories survived publication'

echo 'runtime-bootstrap executable behavior passed'
