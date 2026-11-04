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
apt-get install -y wireguard wireguard-tools iptables curl ufw

mkdir -p /etc/wireguard
chmod 700 /etc/wireguard

if [[ ! -f /etc/wireguard/server_private.key ]]; then
  umask 077
  wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
fi

PRIVATE_KEY=$(cat /etc/wireguard/server_private.key)
PUBLIC_KEY=$(cat /etc/wireguard/server_public.key)
DEFAULT_IF=$(ip route show default | awk '/default/ {print $5; exit}')

# Do not use SaveConfig — it strips PostUp NAT rules on restart.
cat >/etc/wireguard/${WG_IFACE}.conf <<EOF
[Interface]
Address = ${WG_ADDR}
ListenPort = ${WG_PORT}
PrivateKey = ${PRIVATE_KEY}
PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -C FORWARD -i ${WG_IFACE} -j ACCEPT 2>/dev/null || iptables -A FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -C FORWARD -o ${WG_IFACE} -j ACCEPT 2>/dev/null || iptables -A FORWARD -o ${WG_IFACE} -j ACCEPT; iptables -t nat -C POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE
PostDown = iptables -D FORWARD -i ${WG_IFACE} -j ACCEPT 2>/dev/null || true; iptables -D FORWARD -o ${WG_IFACE} -j ACCEPT 2>/dev/null || true; iptables -t nat -D POSTROUTING -o ${DEFAULT_IF} -j MASQUERADE 2>/dev/null || true
EOF

chmod 600 /etc/wireguard/${WG_IFACE}.conf

# Persist IP forwarding across reboot (UFW can leave it off otherwise).
mkdir -p /etc/sysctl.d
cat >/etc/sysctl.d/99-rbvpn-forward.conf <<'EOF'
net.ipv4.ip_forward=1
net.ipv4.conf.all.forwarding=1
EOF
sysctl -w net.ipv4.ip_forward=1
sysctl -w net.ipv4.conf.all.forwarding=1
if grep -q '^net/ipv4/ip_forward=' /etc/ufw/sysctl.conf 2>/dev/null; then
  sed -i 's|^net/ipv4/ip_forward=.*|net/ipv4/ip_forward=1|' /etc/ufw/sysctl.conf
elif grep -q '^#net/ipv4/ip_forward=' /etc/ufw/sysctl.conf 2>/dev/null; then
  sed -i 's|^#net/ipv4/ip_forward=.*|net/ipv4/ip_forward=1|' /etc/ufw/sysctl.conf
else
  echo 'net/ipv4/ip_forward=1' >> /etc/ufw/sysctl.conf
fi

systemctl enable --now wg-quick@${WG_IFACE}

sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw || true
ufw allow OpenSSH || true
ufw allow ${WG_PORT}/udp || true
ufw route allow in on ${WG_IFACE} out on ${DEFAULT_IF} || true
ufw route allow in on ${DEFAULT_IF} out on ${WG_IFACE} || true
ufw --force enable || true
ufw reload || true

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
