import Link from 'next/link';
import SiteNav from '@/components/SiteNav';
import HeroCta from '@/components/HeroCta';

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <SiteNav />
        <div className="hero-stage">
          <div className="hero-inner">
            <h1 className="hero-brand">RB-VPN</h1>
            <p className="hero-kicker">Stays connected when Astrill drops</p>
            <p className="hero-copy">
              Stable connectivity, strong speed, and an exit IP that stays the same when you
              reconnect — not a new address every time.
            </p>
            <HeroCta />
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="hero-orbit" />
            <div className="hero-shield">
              <span className="hero-shield-key" />
            </div>
          </div>
        </div>
      </section>

      <section className="section section-switch">
        <h2>Why switch from Astrill</h2>
        <p className="lead">
          Astrill sometimes disconnects when you need it most. RB-VPN is built for a session that
          stays up — with a steady exit IP and speed you can rely on.
        </p>
        <ul className="advantage-list">
          <li>
            <strong>Fewer surprise disconnects</strong>
            <span>
              Astrill can drop mid-browse or mid-call. RB-VPN keeps the tunnel stable so you stay
              online without constantly reconnecting.
            </span>
          </li>
          <li>
            <strong>Exit IP that does not hop</strong>
            <span>
              Reconnect and keep the same public IP on your chosen location — no rotating address
              every time you click Connect.
            </span>
          </li>
          <li>
            <strong>Stable connectivity</strong>
            <span>
              Consistent links designed to hold through long sessions, not flap when the network
              gets busy or restrictive.
            </span>
          </li>
          <li>
            <strong>Network speed that keeps up</strong>
            <span>
              Dedicated private exits help avoid the slowdowns of overcrowded shared pools — so pages
              load and streams stay smooth.
            </span>
          </li>
          <li>
            <strong>Windows app that stays out of the way</strong>
            <span>
              Install, sign in, connect. No cluttered menus or mystery settings just to get online.
            </span>
          </li>
          <li>
            <strong>Transparent plans</strong>
            <span>
              Clear durations and device limits — pay with card or crypto, then connect.
            </span>
          </li>
        </ul>
      </section>

      <section className="section section-flow">
        <h2>Online in three steps</h2>
        <p className="lead">No complicated setup. Create an account, pick a plan, open the app.</p>
        <ol className="flow-list">
          <li>
            <span className="flow-num">1</span>
            <div>
              <strong>Create your account</strong>
              <p>Register in under a minute.</p>
            </div>
          </li>
          <li>
            <span className="flow-num">2</span>
            <div>
              <strong>Choose a plan</strong>
              <p>Checkout with Stripe or crypto.</p>
            </div>
          </li>
          <li>
            <span className="flow-num">3</span>
            <div>
              <strong>Connect on Windows</strong>
              <p>Download the app and click Connect.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="section section-cta">
        <h2>Ready for a connection that holds?</h2>
        <p className="lead">
          Same exit IP when you reconnect. Stable connectivity and better speed with RB-VPN.
        </p>
        <HeroCta variant="footer" />
      </section>

      <footer>
        © {new Date().getFullYear()} RB-VPN · <Link href="/contact">Contact us</Link>
      </footer>
    </main>
  );
}
