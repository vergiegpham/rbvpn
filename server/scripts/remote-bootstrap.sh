#!/usr/bin/env bash
set -euo pipefail

WG_PORT="${WG_PORT:-51820}"
WG_IFACE="${WG_IFACE:-wg0}"
WG_ADDR="${WG_ADDR:-10.10.0.1/24}"
API_PORT="${API_PORT:-4000}"
INSTALL_DIR="${INSTALL_DIR:-/opt/rbvpn}"
NODE_ID="${NODE_ID:-seed-node-us}"

export DEBIAN_FRONTEND=noninteractive

echo "==> Installing system packages"
apt-get update -y
apt-get install -y wireguard wireguard-tools iptables curl ca-certificates gnupg ufw

echo "==> Installing Node.js 20"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> Configuring WireGuard"
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

systemctl enable wg-quick@${WG_IFACE}
systemctl restart wg-quick@${WG_IFACE} || systemctl start wg-quick@${WG_IFACE}

PUBLIC_IP=$(curl -4 -s --max-time 10 https://ifconfig.me || curl -4 -s --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')

echo "==> Firewall (allow VPN forwarding)"
sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw || true
# Persist MASQUERADE for UFW
if ! grep -q "RB-VPN NAT" /etc/ufw/before.rules 2>/dev/null; then
  python3 - <<PY
from pathlib import Path
path = Path("/etc/ufw/before.rules")
text = path.read_text()
marker = "# RB-VPN NAT"
block = f"""
{marker}
*nat
:POSTROUTING ACCEPT [0:0]
-A POSTROUTING -s 10.10.0.0/24 -o {DEFAULT_IF} -j MASQUERADE
COMMIT
"""
needle = "# Don't delete these required lines"
if needle in text and marker not in text:
    path.write_text(text.replace(needle, block + "\n" + needle, 1))
PY
fi
ufw allow OpenSSH || true
ufw allow ${WG_PORT}/udp || true
ufw allow ${API_PORT}/tcp || true
ufw route allow in on ${WG_IFACE} out on ${DEFAULT_IF} || true
ufw route allow in on ${DEFAULT_IF} out on ${WG_IFACE} || true
ufw --force enable || true
ufw reload || true

echo "==> Writing install metadata"
mkdir -p "${INSTALL_DIR}"
cat >"${INSTALL_DIR}/node-info.env" <<EOF
PUBLIC_IP=${PUBLIC_IP}
WG_PORT=${WG_PORT}
PUBLIC_KEY=${PUBLIC_KEY}
NODE_ID=${NODE_ID}
DEFAULT_IF=${DEFAULT_IF}
EOF

echo "PUBLIC_IP=${PUBLIC_IP}"
echo "PUBLIC_KEY=${PUBLIC_KEY}"
echo "WG_PORT=${WG_PORT}"
wg show || true
echo "WireGuard base install complete"
