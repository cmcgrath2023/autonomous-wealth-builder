import type { Metadata } from 'next';
import { Google_Sans, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { AppShell } from '@/components/layout/AppShell';

const googleSans = Google_Sans({ variable: '--font-google-sans', subsets: ['latin'], weight: ['400', '500', '700'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'MTWM Control',
  description: 'McGrath Trust World Model — Autonomous Wealth Engine',
  icons: {
    icon: '/mcgrath-crest.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${googleSans.variable} ${geistMono.variable} font-sans antialiased bg-[#0a0a1a] text-white min-h-screen`}>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
