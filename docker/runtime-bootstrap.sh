#!/bin/sh
set -eu

umask 077

postgres_root=${POSTGRES_SECRETS_ROOT:-/runtime/postgres}
backend_root=${BACKEND_SECRETS_ROOT:-/runtime/backend}
state_root=${BOOTSTRAP_STATE_ROOT:-/runtime/state}
backend_runtime_gid=${BACKEND_RUNTIME_GID:-1000}
lock_stale_seconds=${BOOTSTRAP_LOCK_STALE_SECONDS:-300}
lock_dir="$state_root/.bootstrap.lock"
lock_token=''
lock_owned=0
postgres_stage=''
backend_stage=''

cleanup() {
  if [ -n "$postgres_stage" ] && [ -d "$postgres_stage" ]; then
    rm -rf "$postgres_stage"
  fi

  if [ -n "$backend_stage" ] && [ -d "$backend_stage" ]; then
    rm -rf "$backend_stage"
  fi

  if [ "$lock_owned" -eq 1 ] && [ -d "$lock_dir" ]; then
    current_token=$(awk 'NR == 1 { print $2 }' "$lock_dir/owner" 2>/dev/null || true)
    if [ -z "$current_token" ] || [ "$current_token" = "$lock_token" ]; then
      rm -rf "$lock_dir"
    fi
  fi
}

fail() {
  echo 'Runtime bootstrap failed.' >&2
  exit 1
}

acquire_lock() {
  lock_token=$(openssl rand -hex 16) || fail
  missing_owner_since=''

  while ! mkdir "$lock_dir" 2>/dev/null; do
    [ -d "$lock_dir" ] || fail
    now=$(date +%s)
    owner_epoch=$(awk 'NR == 1 { print $1 }' "$lock_dir/owner" 2>/dev/null || true)
    lock_is_stale=0

    case "$owner_epoch" in
      ''|*[!0-9]*)
        if [ -z "$missing_owner_since" ]; then
          missing_owner_since=$now
        elif [ $((now - missing_owner_since)) -ge "$lock_stale_seconds" ]; then
          lock_is_stale=1
        fi
        ;;
      *)
        missing_owner_since=''
        if [ $((now - owner_epoch)) -ge "$lock_stale_seconds" ]; then
          lock_is_stale=1
        fi
        ;;
    esac

    if [ "$lock_is_stale" -eq 1 ]; then
      abandoned_lock="$state_root/.bootstrap.lock.abandoned.$lock_token"
      if mv "$lock_dir" "$abandoned_lock" 2>/dev/null; then
        rm -rf "$abandoned_lock"
        missing_owner_since=''
        continue
      fi
    fi

    sleep 1
  done

  lock_owned=1
  printf '%s %s\n' "$(date +%s)" "$lock_token" >"$lock_dir/owner" || fail
}

lock_is_owned() {
  [ -d "$lock_dir" ] || return 1
  current_token=$(awk 'NR == 1 { print $2 }' "$lock_dir/owner" 2>/dev/null || true)
  [ "$current_token" = "$lock_token" ]
}

postgres_volume_is_valid() {
  [ ! -L "$postgres_root/current" ] || return 1
  [ -d "$postgres_root/current" ] || return 1
  [ -s "$postgres_root/current/password" ] || return 1

  password=$(sed -n '1p' "$postgres_root/current/password")
  [ "${#password}" -eq 96 ] || return 1

  case "$password" in
    *[!0-9a-f]*) return 1 ;;
  esac
}

backend_database_password() {
  database_url=$(sed -n '1p' "$backend_root/current/database-url")
  prefix='postgres://defy:'
  suffix='@postgres:5432/defy_db'

  case "$database_url" in
    "$prefix"*"$suffix") ;;
    *) return 1 ;;
  esac

  password=${database_url#"$prefix"}
  password=${password%"$suffix"}
  [ "${#password}" -eq 96 ] || return 1

  case "$password" in
    *[!0-9a-f]*) return 1 ;;
  esac

  printf '%s' "$password"
}

backend_volume_is_valid() {
  [ ! -L "$backend_root/current" ] || return 1
  [ -d "$backend_root/current" ] || return 1

  for filename in database-url jwt-key service-api-key trp-encryption-key ca-cert.pem ca-key.pem server-cert.pem server-key.pem client-cert.pem client-key.pem; do
    [ -s "$backend_root/current/$filename" ] || return 1
  done

  backend_database_password >/dev/null
}

prepare_postgres_stage() {
  database_password=$1
  postgres_stage=$(mktemp -d "$postgres_root/.bootstrap.XXXXXX")
  printf '%s\n' "$database_password" >"$postgres_stage/password"
  chmod 0400 "$postgres_stage/password"
}

prepare_backend_stage() {
  database_password=$1
  backend_stage=$(mktemp -d "$backend_root/.bootstrap.XXXXXX")

  jwt_key=$(openssl rand -hex 64)
  service_api_key=$(openssl rand -hex 32)
  encryption_key=$(openssl rand -base64 32)

  printf 'postgres://defy:%s@postgres:5432/defy_db\n' "$database_password" >"$backend_stage/database-url"
  printf '%s\n' "$jwt_key" >"$backend_stage/jwt-key"
  printf '%s\n' "$service_api_key" >"$backend_stage/service-api-key"
  printf '%s\n' "$encryption_key" >"$backend_stage/trp-encryption-key"

  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 -subj '/CN=Defy Local Development CA' -keyout "$backend_stage/ca-key.pem" -out "$backend_stage/ca-cert.pem" >/dev/null 2>&1
  openssl req -newkey rsa:3072 -nodes -sha256 -subj '/CN=trp.localhost' -addext 'subjectAltName=DNS:localhost,DNS:trp.localhost,IP:127.0.0.1' -addext 'extendedKeyUsage=serverAuth' -keyout "$backend_stage/server-key.pem" -out "$backend_stage/server.csr" >/dev/null 2>&1
  openssl x509 -req -sha256 -days 825 -in "$backend_stage/server.csr" -CA "$backend_stage/ca-cert.pem" -CAkey "$backend_stage/ca-key.pem" -CAcreateserial -copy_extensions copy -out "$backend_stage/server-cert.pem" >/dev/null 2>&1
  openssl req -newkey rsa:3072 -nodes -sha256 -subj '/CN=Defy Local Development Client' -addext 'extendedKeyUsage=clientAuth' -keyout "$backend_stage/client-key.pem" -out "$backend_stage/client.csr" >/dev/null 2>&1
  openssl x509 -req -sha256 -days 825 -in "$backend_stage/client.csr" -CA "$backend_stage/ca-cert.pem" -CAkey "$backend_stage/ca-key.pem" -CAserial "$backend_stage/ca-cert.srl" -copy_extensions copy -out "$backend_stage/client-cert.pem" >/dev/null 2>&1

  rm -f "$backend_stage/server.csr" "$backend_stage/client.csr" "$backend_stage/ca-cert.srl"

  chmod 0400 "$backend_stage/ca-key.pem"
  chmod 0444 "$backend_stage/ca-cert.pem" "$backend_stage/server-cert.pem" "$backend_stage/client-cert.pem"
  chmod 0440 "$backend_stage/database-url" "$backend_stage/jwt-key" "$backend_stage/service-api-key" "$backend_stage/trp-encryption-key" "$backend_stage/server-key.pem" "$backend_stage/client-key.pem"
  chgrp "$backend_runtime_gid" "$backend_stage" "$backend_stage/database-url" "$backend_stage/jwt-key" "$backend_stage/service-api-key" "$backend_stage/trp-encryption-key" "$backend_stage/server-key.pem" "$backend_stage/client-key.pem"
  chmod 0750 "$backend_stage"
}

case "$lock_stale_seconds" in
  ''|*[!0-9]*) fail ;;
esac
[ "$lock_stale_seconds" -gt 0 ] || fail

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

mkdir -p "$postgres_root" "$backend_root" "$state_root"
chmod 0700 "$postgres_root" "$state_root"
chgrp "$backend_runtime_gid" "$backend_root"
chmod 0750 "$backend_root"

acquire_lock

lock_is_owned || fail
find "$postgres_root" "$backend_root" -maxdepth 1 -type d -name '.bootstrap.*' -exec rm -rf -- {} +

postgres_state=absent
backend_state=absent

if [ -e "$postgres_root/current" ] || [ -L "$postgres_root/current" ]; then
  postgres_state=invalid
  if postgres_volume_is_valid; then
    postgres_state=valid
  fi
fi

if [ -e "$backend_root/current" ] || [ -L "$backend_root/current" ]; then
  backend_state=invalid
  if backend_volume_is_valid; then
    backend_state=valid
  fi
fi

[ "$postgres_state" != invalid ] || fail
[ "$backend_state" != invalid ] || fail

if [ "$postgres_state" = valid ] && [ "$backend_state" = valid ]; then
  database_password=$(sed -n '1p' "$postgres_root/current/password")
  backend_password=$(backend_database_password) || fail
  [ "$database_password" = "$backend_password" ] || fail
  echo 'Runtime bootstrap already complete.'
  exit 0
fi

if [ "$postgres_state" = valid ]; then
  database_password=$(sed -n '1p' "$postgres_root/current/password")
elif [ "$backend_state" = valid ]; then
  database_password=$(backend_database_password) || fail
else
  database_password=$(openssl rand -hex 48)
fi

if [ "$postgres_state" = absent ]; then
  prepare_postgres_stage "$database_password"
fi

if [ "$backend_state" = absent ]; then
  prepare_backend_stage "$database_password"
fi

if [ -n "$postgres_stage" ]; then
  lock_is_owned || fail
  mv "$postgres_stage" "$postgres_root/current"
  postgres_stage=''
fi

if [ -n "$backend_stage" ]; then
  lock_is_owned || fail
  mv "$backend_stage" "$backend_root/current"
  backend_stage=''
fi

echo 'Runtime bootstrap completed.'
