import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>© {new Date().getFullYear()} RB-VPN</span>
      <nav className="footer-links" aria-label="Footer">
        <Link href="/pricing">Pricing</Link>
        <Link href="/download">Download</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
      </nav>
    </footer>
  );
}
