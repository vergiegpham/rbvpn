import Link from 'next/link';
import SiteNav from '@/components/SiteNav';
import SiteFooter from '@/components/SiteFooter';

export const metadata = {
  title: 'Privacy Policy — RB-VPN',
  description: 'What RB-VPN stores about your account and connections, and what it does not.',
};

export default function PrivacyPage() {
  return (
    <div className="form-shell">
      <SiteNav />
      <section className="section legal">
        <h2>Privacy Policy</h2>
        <p className="updated">Last updated: November 2026</p>
        <p>
          This page explains what RB-VPN stores to run your account and connections. We keep it to
          what the service needs.
        </p>

        <h3>What we store</h3>
        <ul>
          <li>
            <strong>Account:</strong> your email address, name, and a one-way hash of your password
            (never the password itself).
          </li>
          <li>
            <strong>Plans and payments:</strong> which plan you bought, the amount, the status, and
            the payment provider&apos;s reference. Card details go directly to Stripe and crypto
            payments to NOWPayments; we never see or store card numbers or wallet keys.
          </li>
          <li>
            <strong>Devices:</strong> each device&apos;s name (the Windows app uses your computer
            name), its connection keys, the server you chose, the private VPN address assigned while
            you are connected, and when the device was last connected.
          </li>
          <li>
            <strong>Support:</strong> messages you send through the contact form.
          </li>
        </ul>

        <h3>What we do not store</h3>
        <p>
          We do not record the websites you visit, the content of your traffic, or DNS lookups made
          through the VPN. Your private VPN address is released when you disconnect.
        </p>

        <h3>Technical logs</h3>
        <p>
          Like most online services, our servers keep short-lived technical logs (for example web
          server access logs and service error logs) to keep the service secure and fix problems.
          The Windows app writes a connection log on your own PC to help with troubleshooting; it is
          not uploaded unless you choose to send it to us.
        </p>

        <h3>How we use it</h3>
        <ul>
          <li>to sign you in, provide the plan you paid for, and connect your devices;</li>
          <li>to answer support requests and billing questions;</li>
          <li>to prevent abuse of the service and protect our servers.</li>
        </ul>
        <p>We do not sell your personal data.</p>

        <h3>Sharing</h3>
        <p>
          We share data only with the providers that run parts of the service (payment processors and
          server hosting), or when the law requires it.
        </p>

        <h3>Your choices</h3>
        <ul>
          <li>You can change your password from the dashboard at any time.</li>
          <li>
            To get a copy of your data or delete your account, <Link href="/contact">contact us</Link>{' '}
            from your account email.
          </li>
        </ul>

        <h3>Changes</h3>
        <p>
          If we change this policy we will update this page and the date above; significant changes
          will also be announced by email.
        </p>
      </section>
      <SiteFooter />
    </div>
  );
}
