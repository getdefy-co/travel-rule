#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
smoke_script="$repository_root/scripts/docker-smoke.sh"
command_log=$(mktemp "${TMPDIR:-/tmp}/defy-smoke-schema-failure-log.XXXXXX")

cleanup_test() {
  rm -f "$command_log"
}

fail_test() {
  echo "docker smoke schema-failure test failed: $1" >&2
  exit 1
}

trap cleanup_test EXIT HUP INT TERM

DOCKER_SMOKE_SOURCE_ONLY=1 source "$smoke_script"

docker() {
  printf '%s\n' "$*" >>"$command_log"

  if [[ "$*" == *'exec -T postgres psql'* ]]; then
    [[ "$*" == *'ALTER TABLE orchestration_transfers DROP COLUMN operation_encrypted'* ]] || fail_test 'schema failure fixture did not remove the required transfer-encryption column'
    return
  fi

  if [[ "$*" == *'down'* ]]; then
    return
  fi

  if [[ "$*" == *'up --wait'* ]]; then
    return 1
  fi

  if [[ "$*" == *'ps --status running --quiet backend'* || "$*" == *'ps --status running --quiet gateway'* ]]; then
    return
  fi

  fail_test "unexpected Docker invocation: $*"
}

compose=(docker compose)

assert_canonical_schema_failure

expected_log=$(cat <<'EOF'
compose exec -T postgres psql --username defy --dbname defy_db --set=ON_ERROR_STOP=1 --command=ALTER TABLE orchestration_transfers DROP COLUMN operation_encrypted
compose down
compose up --wait
compose ps --status running --quiet backend
compose ps --status running --quiet gateway
EOF
)
[ "$(cat "$command_log")" = "$expected_log" ] || fail_test 'schema failure acceptance did not recreate the stack against the preserved disposable volume and verify service isolation'

echo 'Docker smoke canonical-schema failure behavior passed'
