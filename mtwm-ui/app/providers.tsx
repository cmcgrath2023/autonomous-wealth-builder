'use client';

import { HeroUIProvider } from '@heroui/react';
import { ThemeProvider as NextThemeProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider attribute="class" defaultTheme="dark" themes={['light', 'dark']}>
      <HeroUIProvider>
        {children}
      </HeroUIProvider>
    </NextThemeProvider>
  );
}
