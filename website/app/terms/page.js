import Link from 'next/link';
import SiteNav from '@/components/SiteNav';
import SiteFooter from '@/components/SiteFooter';

export const metadata = {
  title: 'Terms of Service — RB-VPN',
  description: 'The rules for using RB-VPN accounts, plans, and the Windows app.',
};

export default function TermsPage() {
  return (
    <div className="form-shell">
      <SiteNav />
      <section className="section legal">
        <h2>Terms of Service</h2>
        <p className="updated">Last updated: November 2026</p>
        <p>
          These terms apply to your RB-VPN account, the plans you buy, and the RB-VPN Windows app.
          By creating an account or using the service you agree to them.
        </p>

        <h3>The service</h3>
        <p>
          RB-VPN routes your internet traffic through our servers so websites see the server&apos;s
          IP address instead of yours. We work to keep connections stable, but we cannot guarantee
          uninterrupted access: networks, internet providers, or local rules may slow down or block
          VPN traffic, and servers need maintenance from time to time.
        </p>

        <h3>Your account</h3>
        <ul>
          <li>Give a valid email address and keep your password private.</li>
          <li>You are responsible for activity on your account and the devices you connect.</li>
          <li>Each plan allows a set number of devices; connecting more is not allowed.</li>
        </ul>

        <h3>Acceptable use</h3>
        <p>You may not use RB-VPN to:</p>
        <ul>
          <li>break the law or help anyone else do so;</li>
          <li>send spam, run attacks, scan or break into systems, or spread malware;</li>
          <li>infringe copyrights or other rights of others;</li>
          <li>resell or share access, or overload our servers on purpose.</li>
        </ul>
        <p>
          We may suspend or close accounts that break these rules, with or without notice, to
          protect other customers and our servers.
        </p>

        <h3>Plans and payment</h3>
        <ul>
          <li>Plans are prepaid for the period shown on the pricing page and do not renew on their own.</li>
          <li>Buying a plan while one is active extends your current end date.</li>
          <li>
            Card payments are handled by Stripe and crypto payments by NOWPayments; their terms also
            apply to the payment itself.
          </li>
          <li>
            For billing questions or refund requests, <Link href="/contact">contact us</Link> with
            your account email.
          </li>
        </ul>

        <h3>The Windows app</h3>
        <p>
          The app installs a network service on your PC to create the VPN connection and needs
          administrator approval to do so. Disconnecting or quitting the app removes the connection.
        </p>

        <h3>Liability</h3>
        <p>
          The service is provided &quot;as is&quot;. To the extent the law allows, RB-VPN is not liable
          for indirect or consequential losses, and our total liability is limited to the amount you
          paid for your current plan.
        </p>

        <h3>Changes</h3>
        <p>
          We may update these terms. If a change is significant we will let you know on this page or
          by email before it takes effect. Continuing to use RB-VPN after that means you accept the
          new terms.
        </p>

        <h3>Contact</h3>
        <p>
          Questions about these terms? <Link href="/contact">Send us a message</Link>.
        </p>
      </section>
      <SiteFooter />
    </div>
  );
}
