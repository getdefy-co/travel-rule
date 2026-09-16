#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
smoke_script="$repository_root/scripts/docker-smoke.sh"
command_log=$(mktemp "${TMPDIR:-/tmp}/defy-smoke-cleanup-log.XXXXXX")

cleanup_test() {
  rm -f "$command_log"
}

fail_test() {
  echo "docker smoke cleanup test failed: $1" >&2
  exit 1
}

trap cleanup_test EXIT HUP INT TERM

DOCKER_SMOKE_SOURCE_ONLY=1 source "$smoke_script"

docker() {
  printf '%s\n' "$*" >>"$command_log"

  if [[ "$*" == *' down --volumes --remove-orphans' ]]; then
    return "${FAKE_DOWN_STATUS:-0}"
  fi

  case "$1 $2" in
    'container ls') printf '%s' "${FAKE_CONTAINER_IDS:-}" ;;
    'network ls') printf '%s' "${FAKE_NETWORK_IDS:-}" ;;
    'volume ls') printf '%s' "${FAKE_VOLUME_IDS:-}" ;;
  esac
}

project_name='defy-trp-smoke-cleanup-test'
compose=(docker compose --project-name "$project_name" --file "$repository_root/compose.yaml")

: >"$command_log"
clean_teardown
expected_log=$(cat <<EOF
compose --project-name $project_name --file $repository_root/compose.yaml down --volumes --remove-orphans
container ls --all --quiet --filter label=com.docker.compose.project=$project_name
network ls --quiet --filter label=com.docker.compose.project=$project_name
volume ls --quiet --filter label=com.docker.compose.project=$project_name
EOF
)
[ "$(cat "$command_log")" = "$expected_log" ] || fail_test 'successful teardown did not perform down and all resource checks in order'

: >"$command_log"
export FAKE_DOWN_STATUS=7
if clean_teardown >/dev/null 2>&1; then
  fail_test 'Compose down failure did not propagate'
fi
unset FAKE_DOWN_STATUS
[ "$(wc -l <"$command_log" | tr -d ' ')" -eq 1 ] || fail_test 'resource assertions ran after Compose down failed'

for resource in CONTAINER NETWORK VOLUME; do
  : >"$command_log"
  variable="FAKE_${resource}_IDS"
  export "$variable=leftover-resource"
  if clean_teardown >/dev/null 2>&1; then
    fail_test "remaining $resource resources did not fail teardown"
  fi
  unset "$variable"
done

echo 'Docker smoke clean teardown behavior passed'
