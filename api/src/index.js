import express from 'express';
import cors from 'cors';
import { env } from './utils/env.js';
import authRoutes from './routes/auth.js';
import planRoutes from './routes/plans.js';
import deviceRoutes from './routes/devices.js';
import paymentRoutes from './routes/payments.js';
import agentRoutes from './routes/agent.js';

const app = express();

app.use(
  cors({
    origin: [env.appUrl, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  })
);

app.post(
  '/api/payments/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const { handleStripeWebhook } = await import('./services/payments.js');
      const signature = req.headers['stripe-signature'];
      const result = await handleStripeWebhook(req.body, signature);
      res.json(result);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  }
);

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'rbvpn-api', brand: 'RB-VPN' });
});

app.use('/api/auth', authRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/agent', agentRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(env.port, () => {
  console.log(`RB-VPN API listening on http://localhost:${env.port}`);
});
