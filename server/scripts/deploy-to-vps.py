#!/usr/bin/env python3
"""Deploy local RB-VPN source to the VPS and restart services.

Reads credentials from repo-root `vps info`.
Does NOT overwrite VPS .env / .env.local / databases.

Usage (from repo root):
  python server/scripts/deploy-to-vps.py
  python server/scripts/deploy-to-vps.py --skip-build
  python server/scripts/deploy-to-vps.py --only api,agent
"""

from __future__ import annotations

import argparse
import hashlib
import io
import re
import shutil
import sys
import tarfile
import time
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("Install paramiko first: pip install paramiko")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[2]
VPS_INFO = ROOT / "vps info"
REMOTE_ROOT = "/opt/rbvpn"

SYNC_DIRS = {
    "api": "api",
    "website": "website",
    "agent": "server/vpn-agent",
    "scripts": "server/scripts",
}

SKIP_DIR_NAMES = {"node_modules", ".next", ".git", "dist", "out", "__pycache__"}
SKIP_FILE_NAMES = {".env", ".env.local", ".env.production.local"}
SKIP_SUFFIXES = {".db", ".db-journal", ".log", ".exe", ".msi", ".7z", ".zip"}


def parse_vps_info(path: Path) -> dict[str, str]:
    if not path.exists():
        raise SystemExit(f"Missing {path}. Expected lines like: ip / user / password")
    data: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^(ip|host|user|username|password)\s*[:=]\s*(.+)$", line, re.I)
        if not m:
            continue
        key = m.group(1).lower()
        val = m.group(2).strip()
        if key in {"ip", "host"}:
            data["host"] = val
        elif key in {"user", "username"}:
            data["user"] = val
        elif key == "password":
            data["password"] = val
    if not data.get("host") or not data.get("password"):
        raise SystemExit("vps info must include ip and password")
    data.setdefault("user", "root")
    return data


def should_skip(path: Path) -> bool:
    if any(part in SKIP_DIR_NAMES for part in path.parts):
        return True
    if path.name in SKIP_FILE_NAMES:
        return True
    if path.suffix in SKIP_SUFFIXES:
        return True
    if path.name.startswith("_") and path.suffix in {".py", ".mjs", ".js"}:
        # local one-off helper scripts
        if path.parent.name == "scripts" and path.name.startswith("_"):
            return True
    return False


def build_tarball(targets: list[str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for key in targets:
            rel = SYNC_DIRS[key]
            base = ROOT / rel
            if not base.exists():
                raise SystemExit(f"Missing local path: {base}")
            for p in base.rglob("*"):
                if not p.is_file() or should_skip(p.relative_to(ROOT)):
                    continue
                # also skip if any parent dir is skipped
                if should_skip(p):
                    continue
                arcname = str(Path(rel) / p.relative_to(base)).replace("\\", "/")
                tar.add(p, arcname=arcname)
    return buf.getvalue()


def refresh_download_from_latest_build(local_setup: Path) -> None:
    """Ship the newest client-windows/dist-msi build if it is newer than the downloads copy."""
    builds = sorted(
        (ROOT / "client-windows" / "dist-msi").glob("RB-VPN-Setup-*.msi"),
        key=lambda p: p.stat().st_mtime,
    )
    if not builds:
        return
    newest = builds[-1]
    if local_setup.exists() and local_setup.stat().st_mtime >= newest.stat().st_mtime:
        return
    local_setup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(newest, local_setup)
    print(f"Using latest client build {newest.name} for the download")


def ssh_connect(info: dict[str, str]):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        info["host"],
        username=info["user"],
        password=info["password"],
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )
    return client


def run(client, cmd: str, timeout: int = 1200) -> str:
    print(f">>> {cmd}", flush=True)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    text = out + (("\n" + err) if err.strip() else "")
    printable = text.encode("ascii", "replace").decode()
    if printable.strip():
        print(printable[-6000:], flush=True)
    if code != 0:
        raise SystemExit(f"Remote command failed ({code}): {cmd}")
    return out


# Runs on the VPS. Mirrors api/src/utils/env.js isWeakSecret(): replaces missing, short, or
# published-default secrets, keeping the agent's NODE_AGENT_SECRET in step with the API.
ENSURE_SECRETS_PY = r'''
import secrets
from pathlib import Path

WEAK = {
    "dev-secret", "change-me-to-a-long-random-string", "rbvpn-dev-jwt-secret-change-in-production",
    "rbvpn-prod-jwt-change-me", "change-me-node-agent-secret", "rbvpn-dev-node-agent-secret",
}
API_ENV = Path("/opt/rbvpn/api/.env")
AGENT_ENV = Path("/opt/rbvpn/server/vpn-agent/.env")

def read(path):
    values = {}
    if path.exists():
        for raw in path.read_text(encoding="utf-8").splitlines():
            if "=" in raw and not raw.lstrip().startswith("#"):
                key, value = raw.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values

def write(path, key, value):
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    out, done = [], False
    for raw in lines:
        if raw.split("=", 1)[0].strip() == key and not raw.lstrip().startswith("#"):
            out.append(f"{key}={value}")
            done = True
        else:
            out.append(raw)
    if not done:
        out.append(f"{key}={value}")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")

def weak(value):
    return not value or len(value) < 32 or value in WEAK

api = read(API_ENV)
changed = []
if weak(api.get("JWT_SECRET", "")):
    write(API_ENV, "JWT_SECRET", secrets.token_urlsafe(48))
    changed.append("JWT_SECRET")

agent_secret = api.get("NODE_AGENT_SECRET", "")
if weak(agent_secret):
    agent_secret = secrets.token_urlsafe(48)
    write(API_ENV, "NODE_AGENT_SECRET", agent_secret)
    changed.append("NODE_AGENT_SECRET")
if AGENT_ENV.exists() and read(AGENT_ENV).get("NODE_AGENT_SECRET") != agent_secret:
    write(AGENT_ENV, "NODE_AGENT_SECRET", agent_secret)
    if "NODE_AGENT_SECRET" not in changed:
        changed.append("NODE_AGENT_SECRET (agent copy)")

print("SECRETS_ROTATED=" + ",".join(changed) if changed else "SECRETS_OK")
'''


def ensure_secrets(client) -> list[str]:
    out = run(client, f"python3 - <<'PY'\n{ENSURE_SECRETS_PY}\nPY")
    for line in out.splitlines():
        if line.startswith("SECRETS_ROTATED="):
            rotated = [s for s in line.split("=", 1)[1].split(",") if s]
            if "JWT_SECRET" in rotated:
                print("JWT_SECRET was weak and has been replaced: every user must sign in again.")
            return rotated
    return []


def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy RB-VPN to VPS")
    parser.add_argument(
        "--only",
        default="api,website,agent,scripts",
        help="Comma list: api,website,agent,scripts",
    )
    parser.add_argument("--skip-build", action="store_true", help="Skip website production build")
    parser.add_argument("--skip-install", action="store_true", help="Skip npm install")
    args = parser.parse_args()

    targets = [t.strip() for t in args.only.split(",") if t.strip()]
    for t in targets:
        if t not in SYNC_DIRS:
            raise SystemExit(f"Unknown target '{t}'. Use: {', '.join(SYNC_DIRS)}")

    info = parse_vps_info(VPS_INFO)
    print(f"Deploying to {info['user']}@{info['host']} -> {REMOTE_ROOT}")
    print(f"Targets: {', '.join(targets)}")

    blob = build_tarball(targets)
    print(f"Package size: {len(blob) / 1024:.1f} KB")

    client = ssh_connect(info)
    sftp = client.open_sftp()
    remote_tgz = "/tmp/rbvpn-deploy.tgz"
    try:
        sftp.remove(remote_tgz)
    except OSError:
        pass
    with sftp.file(remote_tgz, "wb") as f:
        f.truncate(0)
        f.write(blob)
        f.flush()

    run(client, f"mkdir -p {REMOTE_ROOT} && rm -f {remote_tgz}.bad; tar -xzf {remote_tgz} -C {REMOTE_ROOT}")

    if "api" in targets:
        # Ensure PostgreSQL is installed and api/.env DATABASE_URL points at it.
        run(
            client,
            f"bash {REMOTE_ROOT}/server/scripts/setup-postgres.sh",
            timeout=900,
        )
        if not args.skip_install:
            run(client, f"cd {REMOTE_ROOT}/api && npm install --omit=dev")
        run(client, f"cd {REMOTE_ROOT}/api && npx prisma generate")
        # schema sync only; does not wipe data on additive changes
        run(client, f"cd {REMOTE_ROOT}/api && npx prisma db push")
        # One-time: copy existing SQLite prod data into Postgres if still present
        run(
            client,
            "apt-get install -y python3-psycopg2 >/dev/null 2>&1 || "
            "apt-get install -y python3-pip >/dev/null 2>&1; "
            "python3 -m pip install --quiet psycopg2-binary 2>/dev/null || true",
            timeout=300,
        )
        run(
            client,
            f"cd {REMOTE_ROOT} && "
            "SQLITE_DB=/opt/rbvpn/api/prisma/prod.db; "
            "if [ -f \"$SQLITE_DB\" ]; then "
            "  DBURL=$(grep -E '^DATABASE_URL=' /opt/rbvpn/api/.env | head -1 | sed -E 's/^DATABASE_URL=//; s/^\"//; s/\"$//'); "
            "  if python3 server/scripts/migrate-sqlite-to-postgres.py "
            "--sqlite \"$SQLITE_DB\" --database-url \"$DBURL\"; then "
            "    mv \"$SQLITE_DB\" \"${SQLITE_DB}.migrated-$(date +%Y%m%d%H%M%S)\"; "
            "    echo 'SQLite archived after successful migration'; "
            "  else "
            "    echo 'SQLite migration failed — left prod.db in place'; exit 1; "
            "  fi; "
            "else echo 'No SQLite prod.db to migrate'; fi",
            timeout=300,
        )

    if "agent" in targets and not args.skip_install:
        run(client, f"cd {REMOTE_ROOT}/server/vpn-agent && npm install --omit=dev")

    rotated: list[str] = []
    if "api" in targets or "agent" in targets:
        rotated = ensure_secrets(client)

    if "website" in targets:
        # keep production API URL if file missing
        run(
            client,
            f"test -f {REMOTE_ROOT}/website/.env.production || "
            f"printf 'NEXT_PUBLIC_API_URL=http://{info['host']}:4000\\n' > {REMOTE_ROOT}/website/.env.production",
        )
        run(
            client,
            f"test -f {REMOTE_ROOT}/website/.env.local || "
            f"cp {REMOTE_ROOT}/website/.env.production {REMOTE_ROOT}/website/.env.local",
        )
        if not args.skip_install:
            run(client, f"cd {REMOTE_ROOT}/website && npm install")
        if not args.skip_build:
            run(client, f"cd {REMOTE_ROOT}/website && npm run build")

    services = []
    if "api" in targets or rotated:
        services.append("rbvpn-api")
    if "agent" in targets or any(s.startswith("NODE_AGENT_SECRET") for s in rotated):
        services.append("rbvpn-agent")
    if "website" in targets:
        services.extend(["rbvpn-web", "nginx"])

    if services:
        run(client, "systemctl daemon-reload")
        run(client, "systemctl restart " + " ".join(services))
        time.sleep(2)
        run(client, "systemctl is-active " + " ".join(services))

    # Upload Windows installer only when content changed (skip identical SHA256)
    local_setup = ROOT / "website" / "public" / "downloads" / "RB-VPN-Setup.msi"
    if "website" in targets:
        refresh_download_from_latest_build(local_setup)
    if "website" in targets and local_setup.exists():
        remote_setup = "/var/www/rbvpn-downloads/RB-VPN-Setup.msi"
        local_sha = hashlib.sha256(local_setup.read_bytes()).hexdigest()
        remote_sha = ""
        try:
            stdin, stdout, stderr = client.exec_command(
                f"sha256sum {remote_setup} 2>/dev/null | awk '{{print $1}}'",
                timeout=30,
            )
            remote_sha = stdout.read().decode("utf-8", "replace").strip()
        except Exception:
            remote_sha = ""

        if remote_sha and remote_sha == local_sha:
            print(
                f"Windows installer unchanged (sha256={local_sha[:12]}…) — skip upload"
            )
        else:
            print(
                f"Uploading Windows installer ({local_setup.stat().st_size / 1024 / 1024:.1f} MB)..."
            )
            run(client, "mkdir -p /var/www/rbvpn-downloads")
            sftp.put(str(local_setup), remote_setup)
            print("Installer uploaded to /var/www/rbvpn-downloads/")
            # Remove legacy .exe download if present
            run(client, "rm -f /var/www/rbvpn-downloads/RB-VPN-Setup.exe || true")
    elif "website" in targets:
        print("No local RB-VPN-Setup.msi — skip installer upload")

    if "api" in targets:
        run(client, f"cd {REMOTE_ROOT}/api && node prisma/seed.js || true")

    run(client, f"curl -s http://127.0.0.1:4000/health || true")
    run(client, "curl -s -o /dev/null -w 'site:%{http_code}\\n' http://127.0.0.1/ || true")
    run(
        client,
        "curl -sI http://127.0.0.1/downloads/RB-VPN-Setup.msi | head -n 5 || true",
    )
    print(f"\nDone. Website: http://{info['host']}/")
    print(f"API health: http://{info['host']}:4000/health")
    client.close()


if __name__ == "__main__":
    main()
