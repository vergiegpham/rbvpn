#!/usr/bin/env bash
# Install PostgreSQL locally and create the RB-VPN database + role.
# Idempotent. Writes/updates DATABASE_URL in /opt/rbvpn/api/.env by default.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/rbvpn}"
API_ENV="${API_ENV:-${INSTALL_DIR}/api/.env}"
DB_NAME="${DB_NAME:-rbvpn}"
DB_USER="${DB_USER:-rbvpn}"
DB_PASS_FILE="${DB_PASS_FILE:-/root/.rbvpn-postgres-password}"

export DEBIAN_FRONTEND=noninteractive

echo "==> Installing PostgreSQL"
apt-get update -y
apt-get install -y postgresql postgresql-contrib

echo "==> Enabling PostgreSQL"
systemctl enable postgresql
systemctl start postgresql

if [[ ! -f "$DB_PASS_FILE" ]]; then
  umask 077
  openssl rand -hex 16 >"$DB_PASS_FILE"
  chmod 600 "$DB_PASS_FILE"
  echo "Generated DB password at $DB_PASS_FILE"
fi
DB_PASS=$(tr -d '\n\r' <"$DB_PASS_FILE")

echo "==> Creating role/database (idempotent)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi

sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
GRANT ALL ON SCHEMA public TO ${DB_USER};
ALTER SCHEMA public OWNER TO ${DB_USER};
SQL

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=public"

echo "==> Updating ${API_ENV} DATABASE_URL"
mkdir -p "$(dirname "$API_ENV")"
export API_ENV DATABASE_URL
python3 - <<'PY'
from pathlib import Path
import os
path = Path(os.environ["API_ENV"])
url = os.environ["DATABASE_URL"]
line = f'DATABASE_URL="{url}"'
if path.exists():
    text = path.read_text(encoding="utf-8")
    lines = []
    replaced = False
    for raw in text.splitlines():
        if raw.startswith("DATABASE_URL="):
            lines.append(line)
            replaced = True
        else:
            lines.append(raw)
    if not replaced:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(line)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
else:
    path.write_text(line + "\n", encoding="utf-8")
print(f"Wrote DATABASE_URL to {path}")
PY

echo "PostgreSQL ready: ${DB_NAME} @ 127.0.0.1 (user ${DB_USER})"
