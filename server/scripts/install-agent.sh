#!/usr/bin/env bash
set -euo pipefail

# Install vpn-agent as a systemd service
# Usage: sudo bash install-agent.sh /opt/rbvpn/server/vpn-agent

AGENT_DIR="${1:-/opt/rbvpn/server/vpn-agent}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)."
  exit 1
fi

if [[ ! -f "${AGENT_DIR}/src/index.js" ]]; then
  echo "Agent not found at ${AGENT_DIR}"
  exit 1
fi

cd "${AGENT_DIR}"
npm install --omit=dev

cat >/etc/systemd/system/rbvpn-agent.service <<EOF
[Unit]
Description=RB-VPN WireGuard node agent
After=network.target wg-quick@wg0.service
Wants=wg-quick@wg0.service

[Service]
Type=simple
WorkingDirectory=${AGENT_DIR}
EnvironmentFile=${AGENT_DIR}/.env
ExecStart=/usr/bin/node ${AGENT_DIR}/src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now rbvpn-agent
systemctl status rbvpn-agent --no-pager
