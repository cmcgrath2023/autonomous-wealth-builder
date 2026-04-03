'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Divider } from '@heroui/react';
import { Squeeze as Hamburger } from 'hamburger-react';
import { ChevronDown, ChevronRight, Home } from 'lucide-react';

interface NavItem { href: string; label: string; icon: string }
interface NavGroup { label: string; icon: string; items: NavItem[]; defaultOpen?: boolean }

const navGroups: (NavItem | NavGroup)[] = [
  { href: '/', label: 'Home', icon: 'home' },
  {
    label: 'Stocks', icon: '⟁', defaultOpen: true, items: [
      { href: '/trading', label: 'Trading', icon: '⟁' },
      { href: '/profit', label: 'Profit & Loss', icon: '⊹' },
      { href: '/options', label: 'Options', icon: '⊘' },
      { href: '/research', label: 'Research', icon: '⊙' },
      { href: '/global', label: 'Global Markets', icon: '⊕' },
    ],
  },
  {
    label: 'Forex & Commodities', icon: '⇄', items: [
      { href: '/forex', label: 'Forex', icon: '⇄' },
      { href: '/metals', label: 'Metals', icon: '◆' },
      { href: '/commodities', label: 'Commodities', icon: '⏣' },
    ],
  },
  { href: '/realestate', label: 'Real Estate', icon: '⌂' },
  {
    label: 'Operations', icon: '◈', items: [
      { href: '/business', label: 'Business Ops', icon: '◈' },
      { href: '/agents', label: 'Agents', icon: '⬡' },
    ],
  },
  {
    label: 'Intelligence', icon: '⊙', items: [
      { href: '/intelligence', label: 'Brain & Learnings', icon: '⊙' },
    ],
  },
  {
    label: 'Planning', icon: '⧫', items: [
      { href: '/strategy', label: 'Strategy', icon: '⧫' },
      { href: '/alternatives', label: 'Alternatives', icon: '◇' },
    ],
  },
];

function isGroup(item: NavItem | NavGroup): item is NavGroup {
  return 'items' in item;
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-blue-500/15 text-blue-400 font-medium'
          : 'text-white/80 hover:bg-white/5 hover:text-white'
      }`}
    >
      {item.icon === 'home' ? <Home size={16} /> : <span className="text-base">{item.icon}</span>}
      {item.label}
    </Link>
  );
}

function NavSection({ group, pathname, expanded, onToggle }: { group: NavGroup; pathname: string; expanded: boolean; onToggle: () => void }) {
  const hasActive = group.items.some(i => pathname === i.href);
  return (
    <div>
      <button
        onClick={onToggle}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full transition-colors ${
          hasActive ? 'text-blue-400' : 'text-white/80 hover:text-white'
        }`}
      >
        <span className="text-base">{group.icon}</span>
        <span className="flex-1 text-left font-medium">{group.label}</span>
        {expanded ? <ChevronDown size={16} className="text-white/50" /> : <ChevronRight size={16} className="text-white/50" />}
      </button>
      {expanded && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/5 pl-2">
          {group.items.map(item => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const item of navGroups) {
      if (isGroup(item)) init[item.label] = item.defaultOpen ?? false;
    }
    return init;
  });

  // Auto-expand group containing the active route
  useEffect(() => {
    for (const item of navGroups) {
      if (isGroup(item) && item.items.some(i => pathname === i.href)) {
        setExpanded(prev => ({ ...prev, [item.label]: true }));
      }
    }
  }, [pathname]);

  // Close sidebar on navigation
  useEffect(() => { setIsOpen(false); }, [pathname]);

  // Close on escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const toggle = (label: string) => setExpanded(prev => ({ ...prev, [label]: !prev[label] }));

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
      <nav className="space-y-0.5 flex-1 overflow-y-auto">
        {navGroups.map((entry) =>
          isGroup(entry) ? (
            <NavSection
              key={entry.label}
              group={entry}
              pathname={pathname}
              expanded={!!expanded[entry.label]}
              onToggle={() => toggle(entry.label)}
            />
          ) : (
            <NavLink key={entry.href} item={entry} pathname={pathname} />
          )
        )}
      </nav>
      <Divider className="my-4 bg-white/5" />
      <div className="text-xs text-white/40 px-3">
        <div>Local Instance</div>
        <div className="mt-1">v6.0</div>
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
