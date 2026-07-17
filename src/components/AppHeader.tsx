'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { I, LogoMark } from '@/components/icons';
import { useAuth } from '@/hooks/useAuth';
import { LoginModal } from '@/components/LoginModal';
import { LanguageToggle } from '@/components/LanguageToggle';
import { TierBadge } from '@/components/TierBadge';
import { Link, usePathname } from '@/i18n/navigation';

interface Props {
  tier?: 'free' | 'pro' | 'max';
  onUpgradePro?: () => void;
}

export function Brand(): JSX.Element {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <LogoMark size={28} />
      <span className="app-craft-brand-word" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
        Excalicast
      </span>
    </Link>
  );
}

export function AppHeader({ tier = 'free', onUpgradePro }: Props): JSX.Element {
  const t = useTranslations('header');
  const pathname = usePathname();
  const onLib = pathname?.startsWith('/library');
  const onRecord = pathname === '/app' || pathname?.startsWith('/export');

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

  useEffect(() => {
    if (loading || user || typeof window === 'undefined') return;
    const next = new URL(window.location.href);
    if (next.searchParams.get('login') !== '1') return;
    setLoginOpen(true);
    next.searchParams.delete('login');
    window.history.replaceState(null, '', `${next.pathname}${next.search}${next.hash}`);
  }, [loading, user]);

  const initial = user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <>
      <header className="app-craft-header flex h-16 flex-shrink-0 items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Brand />
          <nav className="app-craft-main-nav flex items-center gap-2">
            <NavItem href="/library" active={onLib}>{t('library')}</NavItem>
            <NavItem href="/app" active={onRecord}>{t('record')}</NavItem>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          {tier === 'free' && onUpgradePro && (
            <button
              type="button"
              onClick={onUpgradePro}
              className="app-craft-upgrade"
            >
              {t('upgradePro')}
            </button>
          )}
          <TierBadge tier={tier} />

          {loading ? (
            <div className="h-8 w-8 rounded-full" style={{ background: 'var(--paper-2)' }} />
          ) : user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-bold"
                style={{
                  background: 'rgba(255,255,255,0.72)',
                  color: 'var(--ink)',
                  border: '1px solid rgba(31,34,37,0.08)',
                  fontFamily: 'var(--font-mono)',
                  boxShadow: '0 10px 24px rgba(39,28,18,0.08), inset 0 1px 0 rgba(255,255,255,0.82)',
                }}
                title={user.email}
              >
                {initial}
              </button>
              {menuOpen && (
                <div
                  className="app-craft-menu absolute right-0 top-[calc(100%+8px)] z-50 w-[240px] p-2"
                  style={{
                    background: 'rgba(255,253,248,0.94)',
                    border: '1px solid rgba(31,34,37,0.08)',
                    borderRadius: 22,
                    boxShadow: '0 14px 36px rgba(48,38,26,0.09), inset 0 1px 0 rgba(255,255,255,0.74)',
                  }}
                >
                  <div className="px-3 py-2">
                    <div className="label-mono" style={{ fontSize: 9 }}>{t('loggedIn')}</div>
                    <div
                      className="mt-1 truncate text-[13px] font-medium"
                      style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}
                    >
                      {user.email}
                    </div>
                  </div>
                  <div className="my-1.5 h-px" style={{ background: 'var(--rule-faint)' }} />
                  <button
                    type="button"
                    onClick={async () => { await logout(); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-full px-3 py-2 text-[13px]"
                    style={{ color: 'var(--rec)', fontFamily: 'var(--font-sans)', letterSpacing: '-0.01em' }}
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
              className="app-craft-login"
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
      className={active ? 'is-active' : undefined}
      style={{
        position: 'relative',
        fontFamily: 'var(--font-sans)',
        fontSize: 15,
        fontWeight: active ? 650 : 500,
        letterSpacing: '-0.02em',
        color: 'var(--ink)',
        opacity: active ? 1 : 0.68,
        textDecoration: 'none',
        padding: '8px 16px',
        borderRadius: 999,
      }}
    >
      {children}
    </Link>
  );
}
