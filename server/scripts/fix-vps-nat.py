#!/usr/bin/env python3
"""One-shot fix: restore WireGuard NAT + UFW forwarding on the live VPS."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
deploy_path = Path(__file__).resolve().parent / "deploy-to-vps.py"
spec = importlib.util.spec_from_file_location("deploy", deploy_path)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

FIX = r"""
set -euo pipefail
WG_IFACE=wg0
DEFAULT_IF=$(ip route show default | awk '/default/ {print $5; exit}')
PRIVATE_KEY=$(cat /etc/wireguard/server_private.key)
LISTEN_PORT=$(wg show "$WG_IFACE" listen-port 2>/dev/null || echo 51820)
ADDR=$(ip -4 addr show "$WG_IFACE" 2>/dev/null | awk '/inet / {print $2; exit}')
ADDR=${ADDR:-10.10.0.1/24}

echo "DEFAULT_IF=$DEFAULT_IF ADDR=$ADDR PORT=$LISTEN_PORT"

# Capture live peers (pubkey + allowed-ips) before rewrite
mapfile -t PEER_LINES < <(wg show "$WG_IFACE" dump 2>/dev/null | tail -n +2 || true)

sysctl -w net.ipv4.ip_forward=1

{
  cat <<EOF
[Interface]
Address = ${ADDR}
ListenPort = ${LISTEN_PORT}
PrivateKey = ${PRIVATE_KEY}
PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -C FORWARD -i ${WG_IFACE} -j ACCEPT 2>/dev/null || iptables -A FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -C FORWARD -o ${WG_IFACE} -j ACCEPT 2>/dev/null || iptables -A FORWARD -o ${WG_IFACE} -j ACCEPT; iptables -t nat -C POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE
PostDown = iptables -D FORWARD -i ${WG_IFACE} -j ACCEPT 2>/dev/null || true; iptables -D FORWARD -o ${WG_IFACE} -j ACCEPT 2>/dev/null || true; iptables -t nat -D POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE 2>/dev/null || true
EOF
  for line in "${PEER_LINES[@]:-}"; do
    [ -z "$line" ] && continue
    pub=$(echo "$line" | awk '{print $1}')
    allowed=$(echo "$line" | awk '{print $4}')
    cat <<EOF

[Peer]
PublicKey = ${pub}
AllowedIPs = ${allowed}
EOF
  done
} >/etc/wireguard/${WG_IFACE}.conf

chmod 600 /etc/wireguard/${WG_IFACE}.conf

iptables -C FORWARD -i ${WG_IFACE} -j ACCEPT 2>/dev/null || iptables -A FORWARD -i ${WG_IFACE} -j ACCEPT
iptables -C FORWARD -o ${WG_IFACE} -j ACCEPT 2>/dev/null || iptables -A FORWARD -o ${WG_IFACE} -j ACCEPT
iptables -t nat -C POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE

sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw || true

if ! grep -q 'RB-VPN NAT' /etc/ufw/before.rules 2>/dev/null; then
  tmp=$(mktemp)
  awk -v iface="$DEFAULT_IF" '
    BEGIN { inserted=0 }
    /# Don.t delete these required lines/ && !inserted {
      print "# RB-VPN NAT"
      print "*nat"
      print ":POSTROUTING ACCEPT [0:0]"
      print "-A POSTROUTING -s 10.10.0.0/24 -o " iface " -j MASQUERADE"
      print "COMMIT"
      print ""
      inserted=1
    }
    { print }
  ' /etc/ufw/before.rules >"$tmp"
  mv "$tmp" /etc/ufw/before.rules
  echo "Inserted UFW NAT block"
else
  echo "UFW NAT block already present"
fi

ufw allow OpenSSH || true
ufw allow 51820/udp || true
ufw allow 4000/tcp || true
ufw route allow in on ${WG_IFACE} out on ${DEFAULT_IF} || true
ufw route allow in on ${DEFAULT_IF} out on ${WG_IFACE} || true
ufw --force enable || true
ufw reload || true

systemctl restart wg-quick@${WG_IFACE}

echo "--- diagnostics ---"
sysctl net.ipv4.ip_forward
echo "NAT:"
iptables -t nat -L POSTROUTING -n -v | head -n 20
echo "FORWARD:"
iptables -L FORWARD -n -v | head -n 30
echo "UFW:"
ufw status verbose | head -n 40
echo "WG:"
wg show
echo "OK"
"""


def main() -> None:
    info = deploy.parse_vps_info(ROOT / "vps info")
    client = deploy.ssh_connect(info)
    try:
        print(deploy.run(client, FIX, timeout=180))
    finally:
        client.close()


if __name__ == "__main__":
    main()
