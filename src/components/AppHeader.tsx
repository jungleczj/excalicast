'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import { useAuth } from '@/hooks/useAuth';
import { LoginModal } from '@/components/LoginModal';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Link, usePathname } from '@/i18n/navigation';

interface Props {
  tier?: 'free' | 'pro' | 'max';
  onUpgradePro?: () => void;
}

const TIER_BADGE: Record<NonNullable<Props['tier']>, { label: string; bg: string; color: string }> = {
  free: { label: 'Free', bg: 'bg-bg-tertiary',  color: 'text-text-secondary' },
  pro:  { label: 'Pro',  bg: 'bg-primary-100',  color: 'text-primary-700' },
  max:  { label: 'Max',  bg: '',                color: 'text-white' },
};

export function Brand(): JSX.Element {
  return (
    <Link href="/app" className="flex items-center gap-2">
      <div
        className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-white"
        style={{ background: 'linear-gradient(135deg, var(--primary-600) 0%, var(--secondary-600) 100%)' }}
      >
        <I.Logo size={16} />
      </div>
      <span className="text-[15px] font-bold tracking-tight">Excalicast</span>
    </Link>
  );
}

export function AppHeader({ tier = 'free', onUpgradePro }: Props): JSX.Element {
  const t = useTranslations('header');
  const pathname = usePathname();
  const onLib = pathname?.startsWith('/library');
  const onRecord = pathname === '/app' || pathname?.startsWith('/export');
  const badge = TIER_BADGE[tier];

  const { user, logout, loading } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickAway = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClickAway);
    return () => window.removeEventListener('mousedown', onClickAway);
  }, [menuOpen]);

  const initial = user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <>
      <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border-default bg-bg-primary px-5">
        <div className="flex items-center gap-6">
          <Brand />
          <nav className="flex gap-1">
            <NavItem href="/library" active={onLib}>{t('library')}</NavItem>
            <NavItem href="/app" active={onRecord}>{t('record')}</NavItem>
          </nav>
        </div>
        <div className="flex items-center gap-2.5">
          <LanguageToggle />
          {tier === 'free' && onUpgradePro && (
            <button
              type="button"
              onClick={onUpgradePro}
              className="rounded-full px-3 py-[5px] text-[11px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', boxShadow: '0 2px 6px rgba(59,130,246,0.4)' }}
            >
              {t('upgradePro')}
            </button>
          )}
          <span
            className={`rounded-full px-2.5 py-[3px] text-[11px] font-semibold ${badge.bg} ${badge.color}`}
            style={tier === 'max' ? { background: 'linear-gradient(90deg, #9333ea, #db2777)' } : undefined}
          >
            {badge.label}
          </span>

          {loading ? (
            <div className="h-7 w-7 rounded-full bg-bg-tertiary" />
          ) : user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="grid h-7 w-7 place-items-center rounded-full text-[12px] font-semibold text-white transition hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #60a5fa, #a78bfa)' }}
                title={user.email}
              >
                {initial}
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+6px)] z-50 w-[220px] rounded-xl border border-border-default bg-bg-primary p-1.5 shadow-lg"
                  style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.12)' }}
                >
                  <div className="px-2.5 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{t('loggedIn')}</div>
                    <div className="mt-0.5 truncate text-[13px] font-medium text-text-primary">{user.email}</div>
                  </div>
                  <div className="my-1 h-px bg-border-default" />
                  <button
                    type="button"
                    onClick={async () => { await logout(); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-recording-strong hover:bg-bg-tertiary"
                  >
                    {t('logout')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="rounded-md bg-primary-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-700"
              style={{ boxShadow: '0 1px 2px rgba(37,99,235,0.25)' }}
            >
              {t('loginRegister')}
            </button>
          )}
        </div>
      </header>
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}

function NavItem({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
        active
          ? 'bg-bg-tertiary text-text-primary'
          : 'text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary'
      }`}
    >
      {children}
    </Link>
  );
}
