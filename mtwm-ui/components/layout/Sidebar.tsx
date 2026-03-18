'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Divider } from '@heroui/react';
import { Squeeze as Hamburger } from 'hamburger-react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: '◉' },
  { href: '/profit', label: 'Profit', icon: '⊹' },
  { href: '/trading', label: 'Trading', icon: '⟁' },
  { href: '/options', label: 'Options', icon: '⊘' },
  { href: '/forex', label: 'Forex', icon: '⇄' },
  { href: '/metals', label: 'Metals', icon: '◆' },
  { href: '/commodities', label: 'Commodities', icon: '⏣' },
  { href: '/global', label: 'Global Markets', icon: '⊕' },
  { href: '/alternatives', label: 'Alternatives', icon: '◇' },
  { href: '/realestate', label: 'Real Estate', icon: '⌂' },
  { href: '/business', label: 'Business Ops', icon: '◈' },
  { href: '/infrastructure', label: 'AI Infrastructure', icon: '⎔' },
  { href: '/decisions', label: 'Decisions', icon: '⚖' },
  { href: '/activity', label: 'Agent Activity', icon: '⚡' },
  { href: '/agents', label: 'Agents', icon: '⬡' },
  { href: '/strategy', label: 'Strategy Guide', icon: '⧫' },
  { href: '/roadmap', label: 'Roadmap', icon: '⟿' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // Close sidebar on navigation
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close on escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const navContent = (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Image
          src="/mcgrath-crest.svg"
          alt="McGrath Crest"
          width={40}
          height={48}
          className="drop-shadow-lg"
          priority
        />
        <div>
          <h2 className="text-xl font-bold text-blue-400 tracking-tight">MTWM</h2>
          <p className="text-xs text-white/40 mt-0.5">McGrath Trust</p>
        </div>
      </div>
      <Divider className="mb-4 bg-white/5" />
      <nav className="space-y-1 flex-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-blue-500/15 text-blue-400 font-medium'
                  : 'text-white/60 hover:bg-white/5 hover:text-white/90'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <Divider className="my-4 bg-white/5" />
      <div className="text-xs text-white/30 px-3">
        <div>Local Instance</div>
        <div className="mt-1">v6.0 — Spec Compliant</div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <div className="lg:hidden fixed top-3 left-3 z-50">
        <Hamburger
          toggled={isOpen}
          toggle={setIsOpen}
          size={22}
          color="#60a5fa"
          rounded
          label="Toggle menu"
        />
      </div>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Mobile sidebar (slide-in) */}
      <aside
        className={`lg:hidden fixed top-0 left-0 h-full w-64 border-r border-white/5 bg-[#0a0a1a]/95 backdrop-blur-md p-4 flex flex-col z-40 transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="pt-12">{navContent}</div>
      </aside>

      {/* Desktop sidebar (always visible) */}
      <aside className="hidden lg:flex w-64 min-h-screen border-r border-white/5 bg-black/20 backdrop-blur-sm p-4 flex-col">
        {navContent}
      </aside>
    </>
  );
}
