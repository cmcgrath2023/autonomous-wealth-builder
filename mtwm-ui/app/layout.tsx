import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { AppShell } from '@/components/layout/AppShell';

export const metadata: Metadata = {
  title: 'AWB Control',
  description: 'Autonomous Wealth Builder control surface',
  icons: {
    icon: '/mcgrath-crest.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground min-h-screen">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
