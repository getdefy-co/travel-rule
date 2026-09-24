#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
smoke_script="$repository_root/scripts/docker-smoke.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/defy-smoke-management-test.XXXXXX")

cleanup_test() {
  rm -rf "$test_root"
}

trap cleanup_test EXIT

fail_test() {
  echo "docker smoke management test failed: $1" >&2
  exit 1
}

DOCKER_SMOKE_SOURCE_ONLY=1 source "$smoke_script"

fake_compose() {
  if [[ "${1-}" == 'exec' && "${3-}" == 'postgres' ]]; then
    [[ "$*" == *"value_encrypted->>'version' = '2'"* ]] || return 41
    [[ "$*" == *"value_encrypted->>'key_id' = 'primary'"* ]] || return 42
    [[ "$*" == *"ARRAY['algorithm', 'ciphertext', 'iv', 'key_id', 'tag', 'version']"* ]] || return 43
    printf '%s' "${FAKE_ENVELOPE_STATUS:-t}"
    return
  fi

  if [[ "${1-}" == 'exec' && "${3-}" == 'backend' && "${5-}" == '--input-type=module' ]]; then
    cat >/dev/null
    printf '%s' 'synthetic.header.signature'
    return
  fi

  if [[ "${1-}" == 'exec' && "${3-}" == 'backend' ]]; then
    mkdir -p "$test_root/backend-tmp"
    (umask 077 && cat >"$test_root/backend-tmp/service-key-rotation")
    return
  fi

  printf '%s' "${FAKE_ENVELOPE_STATUS:-t}"
}

compose=(fake_compose)

assert_encrypted_configuration_seeded || fail_test 'valid encrypted seed metadata was rejected'

export FAKE_ENVELOPE_STATUS=f
if assert_encrypted_configuration_seeded >/dev/null 2>&1; then
  fail_test 'invalid encrypted seed metadata produced a false-positive result'
fi
unset FAKE_ENVELOPE_STATUS

fixture_root="$test_root/host-fixture"
mkdir -p "$fixture_root"
create_management_rotation_fixture || fail_test 'host rotation fixture creation failed'
[[ "$rotation_key_file" == "$fixture_root/service-key-rotation" ]] || fail_test 'rotation key was not persisted under the host fixture root'
[[ -s "$rotation_key_file" ]] || fail_test 'host rotation fixture is empty'
if host_mode=$(stat -c '%a' "$rotation_key_file" 2>/dev/null); then
  :
else
  host_mode=$(stat -f '%Lp' "$rotation_key_file")
fi
[[ "$host_mode" == '600' ]] || fail_test 'host rotation fixture mode is not 0600'
rotation_digest=$(file_digest "$rotation_key_file") || fail_test 'host rotation fixture could not be digested'

copy_management_rotation_fixture || fail_test 'rotation fixture was not copied before restart'
[[ "$(file_digest "$test_root/backend-tmp/service-key-rotation")" == "$rotation_digest" ]] || fail_test 'first backend copy differs from the host fixture'
if backend_mode=$(stat -c '%a' "$test_root/backend-tmp/service-key-rotation" 2>/dev/null); then
  :
else
  backend_mode=$(stat -f '%Lp' "$test_root/backend-tmp/service-key-rotation")
fi
[[ "$backend_mode" == '600' ]] || fail_test 'backend rotation input mode is not 0600'
rm -rf "$test_root/backend-tmp"
copy_management_rotation_fixture || fail_test 'rotation fixture was not re-copied after simulated restart'
[[ "$(file_digest "$test_root/backend-tmp/service-key-rotation")" == "$rotation_digest" ]] || fail_test 'post-restart backend copy differs from the host fixture'
create_normal_user_jwt_fixture || fail_test 'normal-user JWT host fixture creation failed'
[[ -s "$user_jwt_file" ]] || fail_test 'normal-user JWT host fixture is empty'
[[ "$(cat "$user_jwt_file")" == 'synthetic.header.signature' ]] || fail_test 'normal-user JWT host fixture differs from backend output'
if user_jwt_mode=$(stat -c '%a' "$user_jwt_file" 2>/dev/null); then
  :
else
  user_jwt_mode=$(stat -f '%Lp' "$user_jwt_file")
fi
[[ "$user_jwt_mode" == '600' ]] || fail_test 'normal-user JWT host fixture mode is not 0600'
cleanup
[[ ! -e "$fixture_root" ]] || fail_test 'host rotation fixture survived smoke cleanup'
fixture_root=''

echo 'Docker smoke management behavior passed'
