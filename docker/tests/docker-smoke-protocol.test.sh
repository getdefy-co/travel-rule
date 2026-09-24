#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
smoke_script="$repository_root/scripts/docker-smoke.sh"

fail_test() {
  echo "docker smoke protocol test failed: $1" >&2
  exit 1
}

DOCKER_SMOKE_SOURCE_ONLY=1 source "$smoke_script"

fixture_root='/fixtures'
request_identifier='00000000-0000-4000-8000-000000000001'

curl() {
  local body=''
  local client_certificate=''
  local client_key=''
  local method='GET'
  local target=''

  while (($# > 0)); do
    case "$1" in
      --data)
        body=$2
        shift 2
        ;;
      --cert)
        client_certificate=$2
        shift 2
        ;;
      --key)
        client_key=$2
        shift 2
        ;;
      --request)
        method=$2
        shift 2
        ;;
      --cacert|--header|--output|--write-out)
        shift 2
        ;;
      --silent|--show-error)
        shift
        ;;
      *)
        target=$1
        shift
        ;;
    esac
  done

  if [[ "$target" == 'https://127.0.0.1:3001/travel-rule/trp/inquiries' ]]; then
    [[ "$method" == 'GET' ]] || printf '404'
    [[ "$method" != 'GET' ]] || printf '%s' "${FAKE_JWT_GET_STATUS:-404}"
  elif [[ "$target" == 'https://127.0.0.1:3001/travel-rule/trp/management/analytics' && "$method" == 'GET' ]]; then
    printf '%s' "${FAKE_MANAGEMENT_GET_STATUS:-404}"
  elif [[ "$target" == 'https://127.0.0.1:3001/auth/login' && "$method" == 'POST' ]]; then
    printf '404'
  elif [[ "$target" == 'https://127.0.0.1:3001/travel-rule/trp/travel-addresses' && "$method" == 'POST' ]]; then
    printf '404'
  elif [[ "$target" == 'https://127.0.0.1:3001/travel-rule/trp/protocol/inquiries/missing-token/' && "$method" == 'POST' ]]; then
    printf '404'
  elif [[ "$target" != 'https://127.0.0.1:3001/travel-rule/trp/protocol/resolutions/missing-token' || "$body" != '{"rejected":null}' ]]; then
    printf '400'
  elif [[ -n "$client_certificate" && -n "$client_key" ]]; then
    printf '404'
  else
    printf '401'
  fi
}

[ "$(protocol_request_status without-certificate)" = '401' ] || fail_test 'no-certificate request is not a valid resolution payload'
[ "$(protocol_request_status with-certificate)" = '404' ] || fail_test 'trusted request does not reach missing-token lookup'

assert_public_route_isolated POST '/auth/login' '{}' || fail_test 'POST auth route was not isolated'
assert_public_route_isolated GET '/travel-rule/trp/inquiries' || fail_test 'GET JWT route was not isolated'
assert_public_route_isolated GET '/travel-rule/trp/management/analytics' || fail_test 'GET management route was not isolated'
assert_public_route_isolated POST '/travel-rule/trp/travel-addresses' '{}' || fail_test 'POST API-key route was not isolated'
assert_public_route_isolated POST '/travel-rule/trp/protocol/inquiries/missing-token/' '{}' || fail_test 'POST trailing-slash protocol route was not isolated'

export FAKE_JWT_GET_STATUS=200
if assert_public_route_isolated GET '/travel-rule/trp/inquiries' >/dev/null 2>&1; then
  fail_test 'a leaked GET JWT route produced a false-positive isolation result'
fi
unset FAKE_JWT_GET_STATUS

export FAKE_MANAGEMENT_GET_STATUS=200
if assert_public_route_isolated GET '/travel-rule/trp/management/analytics' >/dev/null 2>&1; then
  fail_test 'a leaked GET management route produced a false-positive isolation result'
fi
unset FAKE_MANAGEMENT_GET_STATUS

echo 'Docker smoke protocol request behavior passed'
