#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
bootstrap_script="$repository_root/docker/runtime-bootstrap.sh"
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/defy-runtime-bootstrap-recovery.XXXXXX")

cleanup() {
  rm -rf "$fixture_root"
}

fail() {
  echo "runtime-bootstrap recovery test failed: $1" >&2
  exit 1
}

prepare_case() {
  case_root="$fixture_root/$1"
  postgres_root="$case_root/postgres"
  backend_root="$case_root/backend"
  state_root="$case_root/state"
  mkdir -p "$postgres_root" "$backend_root" "$state_root"
}

run_bootstrap() {
  POSTGRES_SECRETS_ROOT="$postgres_root" \
    BACKEND_SECRETS_ROOT="$backend_root" \
    BOOTSTRAP_STATE_ROOT="$state_root" \
    BACKEND_RUNTIME_GID="$(id -g)" \
    sh "$bootstrap_script"
}

snapshot_directory() {
  find "$1" -type f -print | LC_ALL=C sort | while IFS= read -r file; do
    relative=${file#"$case_root"/}
    digest=$(openssl dgst -sha256 "$file" | awk '{print $NF}')
    printf '%s %s\n' "$relative" "$digest"
  done
}

assert_database_pair() {
  password=$(sed -n '1p' "$postgres_root/current/password")
  database_url=$(sed -n '1p' "$backend_root/current/database-url")
  [ "$database_url" = "postgres://defy:$password@postgres:5432/defy_db" ] || fail "$1 produced mismatched database credentials"
}

assert_backend_certificates() {
  openssl verify -CAfile "$backend_root/current/ca-cert.pem" "$backend_root/current/server-cert.pem" "$backend_root/current/client-cert.pem" >/dev/null ||
    fail "$1 produced an invalid certificate chain"
}

trap cleanup EXIT HUP INT TERM

prepare_case backend-only
run_bootstrap >/dev/null
backend_before=$(snapshot_directory "$backend_root/current")
rm -rf "$postgres_root/current"
run_bootstrap >/dev/null
[ "$backend_before" = "$(snapshot_directory "$backend_root/current")" ] || fail 'backend-only recovery overwrote the valid backend volume'
assert_database_pair 'backend-only recovery'

prepare_case postgres-only
run_bootstrap >/dev/null
postgres_before=$(snapshot_directory "$postgres_root/current")
rm -rf "$backend_root/current"
run_bootstrap >/dev/null
[ "$postgres_before" = "$(snapshot_directory "$postgres_root/current")" ] || fail 'postgres-only recovery overwrote the valid PostgreSQL volume'
assert_database_pair 'postgres-only recovery'
assert_backend_certificates 'postgres-only recovery'

prepare_case interrupted-publication
run_bootstrap >/dev/null
postgres_before=$(snapshot_directory "$postgres_root/current")
rm -rf "$backend_root/current"
mkdir "$backend_root/.bootstrap.interrupted"
printf '%s\n' 'orphaned-sensitive-stage-data' >"$backend_root/.bootstrap.interrupted/secret"
run_bootstrap >/dev/null
[ "$postgres_before" = "$(snapshot_directory "$postgres_root/current")" ] || fail 'interrupted-publication recovery overwrote the valid PostgreSQL volume'
[ -z "$(find "$postgres_root" "$backend_root" -maxdepth 1 -type d -name '.bootstrap.*' -print)" ] || fail 'interrupted-publication recovery left orphan staging directories'
assert_database_pair 'interrupted-publication recovery'

prepare_case mismatch
run_bootstrap >/dev/null
chmod 0600 "$postgres_root/current/password"
printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' >"$postgres_root/current/password"
mismatch_before=$(snapshot_directory "$case_root")
if run_bootstrap >/dev/null 2>&1; then
  fail 'mismatched completed volumes were accepted'
fi
[ "$mismatch_before" = "$(snapshot_directory "$case_root")" ] || fail 'mismatch failure overwrote existing secrets'

prepare_case corrupt
run_bootstrap >/dev/null
chmod 0600 "$backend_root/current/jwt-key"
: >"$backend_root/current/jwt-key"
corrupt_before=$(snapshot_directory "$case_root")
if run_bootstrap >/dev/null 2>&1; then
  fail 'a corrupt completed volume was accepted'
fi
[ "$corrupt_before" = "$(snapshot_directory "$case_root")" ] || fail 'corrupt-volume failure overwrote existing secrets'

prepare_case stale-lock
mkdir "$state_root/.bootstrap.lock"
printf '%s\n' '0 abandoned-owner' >"$state_root/.bootstrap.lock/owner"
(BOOTSTRAP_LOCK_STALE_SECONDS=1 run_bootstrap) >/dev/null
[ ! -e "$state_root/.bootstrap.lock" ] || fail 'a stale single-writer lock was not recovered'
assert_database_pair 'stale-lock recovery'

prepare_case concurrent
run_bootstrap >"$case_root/first.out" 2>"$case_root/first.err" &
first_pid=$!
run_bootstrap >"$case_root/second.out" 2>"$case_root/second.err" &
second_pid=$!
first_status=0
second_status=0
wait "$first_pid" || first_status=$?
wait "$second_pid" || second_status=$?
[ "$first_status" -eq 0 ] || fail "first concurrent invocation failed with status $first_status"
[ "$second_status" -eq 0 ] || fail "second concurrent invocation failed with status $second_status"
concurrent_output=$(cat "$case_root/first.out" "$case_root/second.out" | LC_ALL=C sort)
expected_output=$(printf '%s\n%s\n' 'Runtime bootstrap already complete.' 'Runtime bootstrap completed.')
[ "$concurrent_output" = "$expected_output" ] || fail 'concurrent invocations did not serialize to completed/already-complete outcomes'
[ ! -e "$state_root/.bootstrap.lock" ] || fail 'the single-writer lock survived successful concurrent invocations'
assert_database_pair 'concurrent bootstrap'
assert_backend_certificates 'concurrent bootstrap'

prepare_case lock-fencing
run_bootstrap >"$case_root/writer.out" 2>"$case_root/writer.err" &
writer_pid=$!
stage_wait_attempts=0
while [ -z "$(find "$backend_root" -maxdepth 1 -type d -name '.bootstrap.*' -print)" ]; do
  kill -0 "$writer_pid" 2>/dev/null || fail 'writer exited before the fencing test could replace its lock'
  stage_wait_attempts=$((stage_wait_attempts + 1))
  [ "$stage_wait_attempts" -lt 200 ] || fail 'writer did not enter its staged generation phase'
  sleep 0.01
done
mv "$state_root/.bootstrap.lock" "$state_root/.bootstrap.lock.expired"
mkdir "$state_root/.bootstrap.lock"
printf '%s %s\n' "$(date +%s)" 'replacement-owner' >"$state_root/.bootstrap.lock/owner"
writer_status=0
wait "$writer_pid" || writer_status=$?
[ "$writer_status" -ne 0 ] || fail 'a writer published after losing its single-writer lock'
[ ! -e "$postgres_root/current" ] || fail 'a fenced writer published PostgreSQL secrets'
[ ! -e "$backend_root/current" ] || fail 'a fenced writer published backend secrets'
rm -rf "$state_root/.bootstrap.lock" "$state_root/.bootstrap.lock.expired"
run_bootstrap >/dev/null
assert_database_pair 'fenced-writer recovery'

echo 'runtime-bootstrap recovery and concurrency behavior passed'
