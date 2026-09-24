#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
smoke_script="$repository_root/scripts/docker-smoke.sh"
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/defy-smoke-idempotency.XXXXXX")
source_root="$fixture_root/source"
snapshot_root="$fixture_root/snapshots"

cleanup_test() {
  rm -rf "$fixture_root"
}

fail_test() {
  echo "docker smoke idempotency test failed: $1" >&2
  exit 1
}

trap cleanup_test EXIT HUP INT TERM

mkdir -p "$source_root/backend" "$source_root/postgres" "$snapshot_root"
for filename in database-url jwt-key service-api-key trp-encryption-key ca-cert.pem ca-key.pem server-cert.pem server-key.pem client-cert.pem client-key.pem; do
  printf 'fixture-%s\n' "$filename" >"$source_root/backend/$filename"
done
printf 'fixture-database-password\n' >"$source_root/postgres/password"

DOCKER_SMOKE_SOURCE_ONLY=1 source "$smoke_script"

docker() {
  if [[ "$1" == 'cp' ]]; then
    local remote=$2
    local destination=$3

    if [[ -n "${FAKE_COPY_STATUS:-}" && "$remote" == *'/runtime/postgres/current/.' ]]; then
      return "$FAKE_COPY_STATUS"
    fi

    case "$remote" in
      *'/runtime/backend/current/.') cp -R "$source_root/backend/." "$destination" ;;
      *'/runtime/postgres/current/.') cp -R "$source_root/postgres/." "$destination" ;;
      *) fail_test "unexpected runtime copy source: $remote" ;;
    esac
    return
  fi

  if [[ "$1" != 'exec' || "$*" != *"SELECT encode(digest(password, 'sha256'), 'hex')"* ]]; then
    fail_test 'admin hash query did not digest the stored bcrypt hash inside PostgreSQL'
  fi

  printf '%064d\n' 0
}

openssl() {
  if [[ -n "${FAKE_DIGEST_FAILURE:-}" && "$*" == *"$FAKE_DIGEST_FAILURE" ]]; then
    return 23
  fi

  command openssl "$@"
}

project_name='defy-trp-smoke-idempotency-test'
compose=(docker)

before=$(snapshot_runtime_material "$snapshot_root/before")
admin_before=$(admin_password_hash_digest)

[ "$(printf '%s\n' "$before" | wc -l | tr -d ' ')" -eq 11 ] || fail_test 'snapshot did not cover every generated runtime file'
printf '%s\n' "$before" | grep -F 'backend/client-key.pem ' >/dev/null || fail_test 'client key digest is missing'
printf '%s\n' "$before" | grep -F 'backend/ca-key.pem ' >/dev/null || fail_test 'CA key digest is missing'
printf '%s\n' "$before" | grep -F 'postgres/password ' >/dev/null || fail_test 'PostgreSQL password digest is missing'
[[ "$before" != *'fixture-'* ]] || fail_test 'snapshot exposed secret material'
[[ "$admin_before" =~ ^[0-9a-f]{64}$ ]] || fail_test 'admin bcrypt hash digest is invalid'

export FAKE_COPY_STATUS=19
if snapshot_runtime_material "$snapshot_root/copy-failure" >/dev/null 2>&1; then
  fail_test 'runtime copy failure did not propagate'
fi
unset FAKE_COPY_STATUS

export FAKE_DIGEST_FAILURE='client-key.pem'
if snapshot_runtime_material "$snapshot_root/digest-failure" >/dev/null 2>&1; then
  fail_test 'runtime digest failure did not propagate'
fi
unset FAKE_DIGEST_FAILURE

mv "$source_root/backend/client-key.pem" "$snapshot_root/client-key.missing"
if snapshot_runtime_material "$snapshot_root/missing-file" >/dev/null 2>&1; then
  fail_test 'runtime snapshot accepted a missing expected file'
fi
mv "$snapshot_root/client-key.missing" "$source_root/backend/client-key.pem"

printf 'unexpected\n' >"$source_root/backend/unexpected-secret"
if snapshot_runtime_material "$snapshot_root/extra-file" >/dev/null 2>&1; then
  fail_test 'runtime snapshot accepted an unexpected file'
fi
rm -f "$source_root/backend/unexpected-secret"

printf 'rotated\n' >"$source_root/backend/client-key.pem"
after=$(snapshot_runtime_material "$snapshot_root/after")
[ "$before" != "$after" ] || fail_test 'runtime material mutation was not detected'

if assert_persisted_material_unchanged "$before" "$admin_before" "$after" "$admin_before" 'bootstrap rerun' >/dev/null 2>&1; then
  fail_test 'changed runtime material was accepted'
fi

changed_admin=$(printf '%064d' 1)
if assert_persisted_material_unchanged "$before" "$admin_before" "$before" "$changed_admin" 'bootstrap rerun' >/dev/null 2>&1; then
  fail_test 'changed administrator password hash digest was accepted'
fi

assert_persisted_material_unchanged "$before" "$admin_before" "$before" "$admin_before" 'restart'

echo 'Docker smoke full-material idempotency behavior passed'
