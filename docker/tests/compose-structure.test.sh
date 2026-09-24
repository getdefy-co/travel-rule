#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

TASK4_COMPOSE_FILE="$repository_root/compose.yaml" ruby <<'RUBY'
require 'yaml'

compose = YAML.safe_load_file(ENV.fetch('TASK4_COMPOSE_FILE'), aliases: false)
services = compose.fetch('services')
backend = services.fetch('backend')
bootstrap = services.fetch('runtime-bootstrap')
postgres = services.fetch('postgres')
admin_bootstrap = services.fetch('admin-bootstrap')
backend_environment = backend.fetch('environment')

unless backend_environment.fetch('FRONTEND_URL') == '${FRONTEND_URL:-http://localhost:3000}'
  raise 'backend reset-link origin is not canonical http://localhost:3000'
end
unless backend_environment.fetch('TRP_EMAIL_FALLBACK_DELAY_MINUTES') == '${TRP_EMAIL_FALLBACK_DELAY_MINUTES:-30}'
  raise 'backend email fallback delay is not configurable with the canonical 30-minute default'
end

raise 'backend exposes EMAIL_PASS in Compose environment' if backend_environment.key?('EMAIL_PASS')
unless backend_environment.fetch('EMAIL_PASS_FILE') == '/run/secrets/email_password'
  raise 'backend EMAIL_PASS_FILE is not the Compose SMTP secret target'
end

unless backend.fetch('volumes').include?('backend-secrets:/run/secrets/backend:ro')
  raise 'backend runtime-secret volume is not mounted read-only'
end
unless backend.fetch('secrets').include?({ 'source' => 'smtp-password', 'target' => 'email_password' })
  raise 'backend does not mount the external SMTP password secret'
end
unless compose.fetch('secrets').fetch('smtp-password').fetch('file') == '${SMTP_PASSWORD_FILE:-./docker/secrets/email_password.disabled}'
  raise 'SMTP password secret lacks the external-file override and disabled placeholder default'
end
unless bootstrap.fetch('environment').fetch('BOOTSTRAP_STATE_ROOT') == '/runtime/state'
  raise 'runtime bootstrap does not use the shared state root'
end
unless bootstrap.fetch('volumes').include?('bootstrap-state:/runtime/state')
  raise 'runtime bootstrap does not mount the shared single-writer state volume'
end
raise 'bootstrap-state named volume is not declared' unless compose.fetch('volumes').key?('bootstrap-state')
unless postgres.fetch('volumes').include?('./backend/src/schemas/database.sql:/docker-entrypoint-initdb.d/001-database.sql:ro')
  raise 'PostgreSQL does not mount the canonical fresh-install SQL through the native initialization directory'
end
raise 'PostgreSQL Compose volumes reference migrations' if postgres.fetch('volumes').any? { |volume| volume.include?('migrations') }
unless admin_bootstrap.fetch('depends_on').fetch('postgres').fetch('condition') == 'service_healthy'
  raise 'admin bootstrap is not ordered after PostgreSQL readiness'
end
unless backend.fetch('depends_on').fetch('admin-bootstrap').fetch('condition') == 'service_completed_successfully'
  raise 'backend is not gated on successful canonical schema and administrator bootstrap'
end
unless admin_bootstrap.fetch('networks') == ['data'] && compose.fetch('networks').fetch('data').fetch('internal') == true
  raise 'admin bootstrap or PostgreSQL data network is not internal-only'
end
raise 'backend exposes its internal listener' if backend.fetch('ports').any? { |binding| binding.include?(':3002') }
raise 'PostgreSQL exposes a host listener' if postgres.key?('ports')
RUBY

echo 'Compose runtime-secret structure passed'

TASK4_NGINX_FILE="$repository_root/docker/nginx/nginx.conf" ruby <<'RUBY'
nginx = File.read(ENV.fetch('TASK4_NGINX_FILE'))

unless nginx.include?('location ~ ^/travel-rule/trp/inquiries(?:/.*)?$')
  raise 'gateway does not proxy the exact inquiry-review subtree'
end
unless nginx.include?('location ~ ^/travel-rule/trp/management(?:/.*)?$')
  raise 'gateway does not proxy the exact management subtree'
end
unless nginx.include?('location ~ ^/travel-rule/v1/cases(?:/.*)?$')
  raise 'gateway does not proxy the exact compliance-case subtree'
end
unless nginx.include?('location = /travel-rule/trp/email-access/consume')
  raise 'gateway does not proxy the exact public email consume endpoint'
end
unless nginx.include?('add_header Referrer-Policy "no-referrer" always;')
  raise 'gateway does not prevent referrer disclosure from shared links'
end

if nginx.match?(%r{location\s+(?:\^~\s+)?/travel-rule/trp/\s*\{})
  raise 'gateway exposes the complete TRP subtree instead of exact JWT paths only'
end

unless nginx.scan('proxy_pass http://backend:3002;').length == 5
  raise 'gateway backend proxy surface must remain limited to auth, review, management, compliance cases, and exact email consume'
end
RUBY

echo 'Nginx JWT boundary passed'
