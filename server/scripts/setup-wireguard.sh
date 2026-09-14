#!/usr/bin/env bash
set -euo pipefail

# RB-VPN Linux WireGuard node bootstrap
# Usage: sudo bash setup-wireguard.sh

WG_PORT="${WG_PORT:-51820}"
WG_IFACE="${WG_IFACE:-wg0}"
WG_SUBNET="${WG_SUBNET:-10.10.0.0/24}"
WG_ADDR="${WG_ADDR:-10.10.0.1/24}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y wireguard wireguard-tools iptables curl

mkdir -p /etc/wireguard
chmod 700 /etc/wireguard

if [[ ! -f /etc/wireguard/server_private.key ]]; then
  umask 077
  wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
fi

PRIVATE_KEY=$(cat /etc/wireguard/server_private.key)
PUBLIC_KEY=$(cat /etc/wireguard/server_public.key)

cat >/etc/wireguard/${WG_IFACE}.conf <<EOF
[Interface]
Address = ${WG_ADDR}
ListenPort = ${WG_PORT}
PrivateKey = ${PRIVATE_KEY}
SaveConfig = true
PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -A FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -A FORWARD -o ${WG_IFACE} -j ACCEPT; iptables -t nat -A POSTROUTING -o \$(ip route show default | awk '/default/ {print \$5; exit}') -j MASQUERADE
PostDown = iptables -D FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -D FORWARD -o ${WG_IFACE} -j ACCEPT; iptables -t nat -D POSTROUTING -o \$(ip route show default | awk '/default/ {print \$5; exit}') -j MASQUERADE
EOF

chmod 600 /etc/wireguard/${WG_IFACE}.conf
systemctl enable --now wg-quick@${WG_IFACE}

PUBLIC_IP=$(curl -4 -s https://ifconfig.me || curl -4 -s https://api.ipify.org || echo "YOUR_VPS_PUBLIC_IP")

echo ""
echo "=== RB-VPN WireGuard node ready ==="
echo "Interface: ${WG_IFACE}"
echo "ListenPort: ${WG_PORT}"
echo "Public IP: ${PUBLIC_IP}"
echo "Server public key: ${PUBLIC_KEY}"
echo ""
echo "Update API seed / admin node with:"
echo "  publicHost = ${PUBLIC_IP}"
echo "  publicPort = ${WG_PORT}"
echo "  publicKey  = ${PUBLIC_KEY}"
echo ""
echo "Then run the vpn-agent with NODE_ID pointing at that node."
