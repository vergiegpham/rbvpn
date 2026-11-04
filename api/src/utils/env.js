import dotenv from 'dotenv';
dotenv.config();

export const env = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  nowPaymentsApiKey: process.env.NOWPAYMENTS_API_KEY || '',
  nowPaymentsIpnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
  nowPaymentsSandbox: process.env.NOWPAYMENTS_SANDBOX !== 'false',
  // Test checkout that activates plans without charging. Never enable on a public server.
  allowMockPayments: process.env.ALLOW_MOCK_PAYMENTS === 'true',
  nodeAgentSecret: process.env.NODE_AGENT_SECRET || 'change-me-node-agent-secret',
  // Release VPN sessions whose peer has not handshaked for this long (needs agent handshake reports).
  staleSessionHours: Number(process.env.STALE_SESSION_HOURS || 24),
  interserverUsername: process.env.INTERSERVER_USERNAME || '',
  interserverPassword: process.env.INTERSERVER_PASSWORD || process.env.INTERSERVER_API_KEY || '',
};

const KNOWN_WEAK_SECRETS = new Set([
  'dev-secret',
  'change-me-to-a-long-random-string',
  'rbvpn-dev-jwt-secret-change-in-production',
  'rbvpn-prod-jwt-change-me',
  'change-me-node-agent-secret',
  'rbvpn-dev-node-agent-secret',
]);

export function isWeakSecret(value) {
  return !value || value.length < 32 || KNOWN_WEAK_SECRETS.has(value);
}

/** True for empty values and the placeholders shipped in .env.example (sk_test_xxx, price_xxx, …). */
export function isPlaceholder(value) {
  return !value || /xxx|change-me|REPLACE_WITH/i.test(String(value));
}

export function configWarnings() {
  const warnings = [];
  if (isWeakSecret(env.jwtSecret)) {
    warnings.push('JWT_SECRET is missing, short, or a published default — login tokens can be forged.');
  }
  if (isWeakSecret(env.nodeAgentSecret)) {
    warnings.push('NODE_AGENT_SECRET is missing, short, or a published default — agent endpoints are exposed.');
  }
  if (env.allowMockPayments) {
    warnings.push('ALLOW_MOCK_PAYMENTS=true — anyone can activate plans without paying.');
  }
  return warnings;
}
