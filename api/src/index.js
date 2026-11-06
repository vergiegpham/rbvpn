import express from 'express';
import cors from 'cors';
import { env } from './utils/env.js';
import authRoutes from './routes/auth.js';
import planRoutes from './routes/plans.js';
import deviceRoutes from './routes/devices.js';
import paymentRoutes from './routes/payments.js';
import agentRoutes from './routes/agent.js';
import adminRoutes from './routes/admin.js';
import contactRoutes from './routes/contact.js';
import { handleStripeWebhook } from './services/payments.js';
import { startSessionSweeper } from './services/sessions.js';

const app = express();
// Use X-Forwarded-For only when a reverse proxy on this host (nginx) forwards the request.
app.set('trust proxy', 'loopback');

app.use(
  cors({
    // Electron client + website may hit the API from the VPS IP or localhost.
    origin: true,
    credentials: true,
  })
);

app.post(
  '/api/payments/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const result = await handleStripeWebhook(req.body, req.headers['stripe-signature']);
      res.json(result);
    } catch (err) {
      if (!err.status || err.status >= 500) console.error('Stripe webhook error:', err);
      res.status(err.status || 500).json({ error: err.message });
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
app.use('/api/admin', adminRoutes);
app.use('/api/contact', contactRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  if (err?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
  if (err?.code === 'P2002') return res.status(409).json({ error: 'Already exists' });

  const status = Number(err?.status || err?.statusCode) || 500;
  if (status < 500) {
    const message = err.expose === false ? 'Bad request' : err.message || 'Bad request';
    return res.status(status).json({ error: message });
  }
  console.error(err);
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

app.listen(env.port, () => {
  console.log(`RB-VPN API listening on http://localhost:${env.port}`);
  startSessionSweeper();
});
