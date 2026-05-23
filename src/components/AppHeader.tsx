'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { I, LogoMark } from '@/components/icons';
import { useAuth } from '@/hooks/useAuth';
import { LoginModal } from '@/components/LoginModal';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Link, usePathname } from '@/i18n/navigation';

interface Props {
  tier?: 'free' | 'pro' | 'max';
  onUpgradePro?: () => void;
}

const TIER_VARIANT: Record<NonNullable<Props['tier']>, string> = {
  free: 'tag-mono-soft',
  pro: 'tag-mono-pro',
  max: 'tag-mono-max',
};

export function Brand(): JSX.Element {
  return (
    <Link href="/app" className="flex items-center gap-2.5">
      <LogoMark size={28} />
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
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
  const badgeClass = TIER_VARIANT[tier];
  const badgeLabel = tier === 'free' ? 'FREE' : tier === 'pro' ? 'PRO' : 'MAX';

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
      <header
        className="flex h-14 flex-shrink-0 items-center justify-between px-6"
        style={{
          background: 'var(--paper)',
          borderBottom: '2px solid var(--ink)',
          color: 'var(--ink)',
        }}
      >
        <div className="flex items-center gap-8">
          <Brand />
          <nav className="flex items-center gap-6">
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
              className="btn-sketch btn-sketch-hi"
              style={{ padding: '8px 14px', fontSize: 11 }}
            >
              {t('upgradePro')}
            </button>
          )}
          <span className={`tag-mono ${badgeClass}`}>{badgeLabel}</span>

          {loading ? (
            <div className="h-8 w-8 rounded-full" style={{ background: 'var(--paper-2)' }} />
          ) : user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-bold"
                style={{
                  background: 'var(--paper)',
                  color: 'var(--ink)',
                  border: '1.5px solid var(--ink)',
                  fontFamily: 'var(--font-mono)',
                }}
                title={user.email}
              >
                {initial}
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+8px)] z-50 w-[240px] p-2"
                  style={{
                    background: 'var(--paper)',
                    border: '1.6px solid var(--ink)',
                    borderRadius: 4,
                    boxShadow: '4px 4px 0 var(--ink)',
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
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[13px]"
                    style={{ color: 'var(--rec)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
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
              className="btn-sketch btn-sketch-primary"
              style={{ padding: '8px 14px', fontSize: 11 }}
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
      style={{
        position: 'relative',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--ink)',
        opacity: active ? 1 : 0.55,
        textDecoration: 'none',
        paddingBottom: 4,
        borderBottom: active ? '2px solid var(--ink)' : '2px solid transparent',
      }}
    >
      {children}
    </Link>
  );
}
