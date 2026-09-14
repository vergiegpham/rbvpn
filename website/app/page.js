import Link from 'next/link';
import SiteNav from '@/components/SiteNav';

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <SiteNav />
        <div className="hero-inner">
          <h1 className="hero-brand">RB-VPN</h1>
          <p className="hero-copy">
            Private WireGuard tunnels through your own VPS exit IPs. Fast Windows client,
            Linux nodes, and checkout with Stripe or crypto.
          </p>
          <div className="cta-row">
            <Link href="/register" className="btn-primary">
              Start free account
            </Link>
            <Link href="/pricing" className="btn-secondary">
              View plans
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Built for exit-IP routing</h2>
        <p className="lead">
          Your PC connects over WireGuard to a Linux VPS. Sites see the VPS public IP —
          the same architecture as a self-hosted gateway, packaged as a sellable service.
        </p>
        <div className="pricing-grid">
          <div className="price-panel">
            <h3>Windows client</h3>
            <p className="lead" style={{ margin: 0 }}>
              Login, pull config, connect/disconnect with the official WireGuard engine.
            </p>
          </div>
          <div className="price-panel">
            <h3>Linux VPN nodes</h3>
            <p className="lead" style={{ margin: 0 }}>
              WireGuard + NAT on VPS. An agent syncs peers from the control API.
            </p>
          </div>
          <div className="price-panel">
            <h3>Payments</h3>
            <p className="lead" style={{ margin: 0 }}>
              Stripe card checkout and NOWPayments crypto invoices in one billing flow.
            </p>
          </div>
        </div>
      </section>

      <footer>© {new Date().getFullYear()} RB-VPN</footer>
    </main>
  );
}
