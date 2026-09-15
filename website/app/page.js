import Link from 'next/link';
import SiteNav from '@/components/SiteNav';
import HeroCta from '@/components/HeroCta';

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <SiteNav />
        <div className="hero-inner">
          <h1 className="hero-brand">RB-VPN</h1>
          <p className="hero-copy">
            Private encrypted access through dedicated VPS exit IPs. Fast Windows app,
            global nodes, and checkout with Stripe or crypto.
          </p>
          <HeroCta />
        </div>
      </section>

      <section className="section">
        <h2>Built for exit-IP routing</h2>
        <p className="lead">
          Your PC connects to an RB-VPN node. Websites see the VPS public IP — packaged as a
          simple service with account, billing, and a one-click Windows app.
        </p>
        <div className="pricing-grid">
          <div className="price-panel">
            <h3>Windows app</h3>
            <p className="lead" style={{ margin: 0 }}>
              Install the RB-VPN .exe, sign in, and connect in one click.
            </p>
          </div>
          <div className="price-panel">
            <h3>Private nodes</h3>
            <p className="lead" style={{ margin: 0 }}>
              Linux VPS nodes with encrypted tunnels and automatic account provisioning.
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

      <footer>
        © {new Date().getFullYear()} RB-VPN · <Link href="/contact">Contact us</Link>
      </footer>
    </main>
  );
}
