#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
smoke_script="$repository_root/scripts/docker-smoke.sh"
command_log=$(mktemp "${TMPDIR:-/tmp}/defy-smoke-port-log.XXXXXX")

cleanup_test() {
  rm -f "$command_log"
}

fail_test() {
  echo "docker smoke port binding test failed: $1" >&2
  exit 1
}

trap cleanup_test EXIT HUP INT TERM

DOCKER_SMOKE_SOURCE_ONLY=1 source "$smoke_script"

docker() {
  printf '%s\n' "$*" >>"$command_log"

  if [[ "$1 $2 $3 $4" == 'compose ps --quiet frontend' ]]; then
    printf 'frontend-container\n'
    return
  fi

  if [[ "$1" == 'inspect' && "${!#}" == 'frontend-container' ]]; then
    printf '%s\n' "${FAKE_PORT_BINDING:-null}"
    return
  fi

  if [[ "$1 $2 $3 $4" == 'compose port frontend 3000' ]]; then
    printf ':0\n'
    return
  fi

  fail_test "unexpected Docker invocation: $*"
}

compose=(docker compose)

assert_unpublished frontend 3000
if grep -F 'compose port frontend 3000' "$command_log" >/dev/null; then
  fail_test 'unpublished-port verification relied on the ambiguous Compose port output'
fi

export FAKE_PORT_BINDING='[{"HostIp":"0.0.0.0","HostPort":"3000"}]'
if (assert_unpublished frontend 3000) >/dev/null 2>&1; then
  fail_test 'an actual host port binding was accepted'
fi

echo 'Docker smoke host-port binding behavior passed'
