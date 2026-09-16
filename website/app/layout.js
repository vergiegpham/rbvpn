import { Syne, Source_Sans_3 } from 'next/font/google';
import './globals.css';

const display = Syne({
  subsets: ['latin'],
  variable: '--font-display-next',
  weight: ['600', '700', '800'],
});

const body = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-body-next',
  weight: ['400', '500', '600', '700'],
});

export const metadata = {
  title: 'RB-VPN — Stays connected when Astrill drops',
  description:
    'RB-VPN keeps a stable exit IP across reconnects, with fewer surprise disconnects than Astrill and steady network speed. Simple Windows app and transparent plans.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
