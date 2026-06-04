'use client';

import { useState, type JSX } from 'react';
import { I } from '@/components/icons';
import { track } from '@vercel/analytics';

/**
 * "▶ View demo" affordance + modal. Only rendered by the landing when
 * `public/demo.mp4` actually exists (checked server-side), so there is never a
 * broken/empty player. Plays the user-provided demo recording.
 */
export function DemoButton({ label, closeLabel }: { label: string; closeLabel: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn-sketch btn-stamp lift"
        onClick={() => {
          track('view_demo');
          setOpen(true);
        }}
      >
        <I.Play size={13} /> {label}
      </button>
      {open && (
        <div
          className="fade-in fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: 'rgba(26,26,26,0.55)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full"
            style={{ maxWidth: 880, background: 'var(--ink)', border: '2px solid var(--ink)', borderRadius: 6, boxShadow: '6px 6px 0 var(--hi)', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1.5px solid rgba(255,255,255,0.15)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--hi)' }}>● demo</span>
              <button type="button" onClick={() => setOpen(false)} aria-label={closeLabel} style={{ background: 'transparent', border: 'none', color: 'var(--paper)', cursor: 'pointer', display: 'flex' }}>
                <I.Close size={18} />
              </button>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src="/demo.mp4" controls autoPlay loop muted playsInline style={{ display: 'block', width: '100%', height: 'auto', background: '#000', aspectRatio: '16 / 9' }} />
          </div>
        </div>
      )}
    </>
  );
}
