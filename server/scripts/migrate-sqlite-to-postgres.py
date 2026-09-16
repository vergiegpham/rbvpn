#!/usr/bin/env python3
"""Copy RB-VPN data from a Prisma SQLite file into PostgreSQL.

Usage on VPS:
  python3 server/scripts/migrate-sqlite-to-postgres.py \\
    --sqlite /opt/rbvpn/api/prisma/prod.db \\
    --database-url 'postgresql://rbvpn:...@127.0.0.1:5432/rbvpn?schema=public'
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from urllib.parse import unquote, urlparse


TABLES = [
    "User",
    "Plan",
    "VpnNode",
    "Subscription",
    "Device",
    "Payment",
    "ContactMessage",
]

BOOL_COLS = {
    "User": {"suspended"},
    "Plan": {"active"},
    "VpnNode": {"active"},
}

DATE_COLS = {
    "User": {"suspendedAt", "createdAt", "updatedAt"},
    "Plan": {"createdAt"},
    "VpnNode": {"createdAt", "updatedAt"},
    "Subscription": {"startsAt", "endsAt", "createdAt", "updatedAt"},
    "Device": {"lastSeenAt", "createdAt", "updatedAt"},
    "Payment": {"createdAt", "updatedAt"},
    "ContactMessage": {"createdAt", "updatedAt"},
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Migrate RB-VPN SQLite → PostgreSQL")
    p.add_argument("--sqlite", required=True, help="Path to Prisma SQLite .db file")
    p.add_argument("--database-url", required=True, help="postgresql://… URL")
    p.add_argument(
        "--force",
        action="store_true",
        help="Replace existing Postgres rows (truncate tables first)",
    )
    return p.parse_args()


def parse_pg_url(url: str) -> dict:
    u = urlparse(url)
    if u.scheme not in {"postgresql", "postgres"}:
        raise SystemExit(f"Expected postgresql:// URL, got: {url}")
    db = (u.path or "/").lstrip("/")
    if "?" in db:
        db = db.split("?", 1)[0]
    return {
        "host": u.hostname or "127.0.0.1",
        "port": u.port or 5432,
        "user": unquote(u.username or ""),
        "password": unquote(u.password or ""),
        "dbname": db or "rbvpn",
    }


def to_bool(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    s = str(v).strip().lower()
    if s in {"1", "true", "t", "yes"}:
        return True
    if s in {"0", "false", "f", "no", ""}:
        return False
    return bool(v)


def to_dt(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, (int, float)):
        ts = float(v)
        if ts > 1e12:  # ms
            ts /= 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    s = str(v).strip()
    if s.isdigit():
        ts = float(s)
        if ts > 1e12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        try:
            return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            return datetime.strptime(s[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)


def convert_row(table: str, cols: list[str], row: tuple) -> tuple:
    bools = BOOL_COLS.get(table, set())
    dates = DATE_COLS.get(table, set())
    out = []
    for col, val in zip(cols, row):
        if col in bools:
            out.append(to_bool(val))
        elif col in dates:
            out.append(to_dt(val))
        else:
            out.append(val)
    return tuple(out)


def main() -> None:
    args = parse_args()
    try:
        import psycopg2
        from psycopg2.extras import execute_batch
    except ImportError:
        raise SystemExit("Install psycopg2-binary first: pip install psycopg2-binary")

    pg = parse_pg_url(args.database_url)
    sqlite_path = args.sqlite

    src = sqlite3.connect(sqlite_path)
    src.row_factory = sqlite3.Row
    dst = psycopg2.connect(**pg)
    dst.autocommit = False

    try:
        with dst.cursor() as cur:
            if args.force:
                # reverse FK order
                for table in reversed(TABLES):
                    cur.execute(f'TRUNCATE TABLE "{table}" CASCADE')
                    print(f"truncated {table}")

            for table in TABLES:
                rows = src.execute(f'SELECT * FROM "{table}"').fetchall()
                if not rows:
                    print(f"{table}: 0 rows")
                    continue
                cols = list(rows[0].keys())
                # Skip rows that already exist (by id)
                existing = set()
                if not args.force:
                    cur.execute(f'SELECT id FROM "{table}"')
                    existing = {r[0] for r in cur.fetchall()}

                to_insert = []
                for r in rows:
                    if r["id"] in existing:
                        continue
                    to_insert.append(convert_row(table, cols, tuple(r[c] for c in cols)))

                if not to_insert:
                    print(f"{table}: all {len(rows)} already present — skip")
                    continue

                placeholders = ",".join(["%s"] * len(cols))
                col_list = ",".join(f'"{c}"' for c in cols)
                sql = f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders})'
                execute_batch(cur, sql, to_insert, page_size=100)
                print(f"{table}: inserted {len(to_insert)} / {len(rows)}")

        dst.commit()
        print("Migration OK")
    except Exception:
        dst.rollback()
        raise
    finally:
        src.close()
        dst.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
