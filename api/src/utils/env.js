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
  nodeAgentSecret: process.env.NODE_AGENT_SECRET || 'change-me-node-agent-secret',
  interserverUsername: process.env.INTERSERVER_USERNAME || '',
  interserverPassword: process.env.INTERSERVER_PASSWORD || process.env.INTERSERVER_API_KEY || '',
};
