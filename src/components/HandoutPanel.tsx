'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';

interface Chapter {
  startMs: number;
  endMs: number;
  title: string;
  summary: string;
}

interface HandoutResponse {
  outline: { title?: string; chapters?: Chapter[] } | unknown;
  markdown: string;
  model?: string;
  generatedAt?: number;
}

interface Props {
  recordingId: string;
  /** 切换时使用：父组件可监听章节点击跳转预览时间 */
  onJumpToTime?: (ms: number) => void;
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function HandoutPanel({ recordingId, onJumpToTime }: Props): JSX.Element {
  const t = useTranslations('exportPanel');
  const [data, setData] = useState<HandoutResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 初次加载：看看是否已有讲义
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/handout/${encodeURIComponent(recordingId)}`)
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) { setData(null); return; }
        if (!r.ok) { setError(`load ${r.status}`); return; }
        const json = (await r.json()) as HandoutResponse;
        setData(json);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'load_failed'); });
    return () => { cancelled = true; };
  }, [recordingId]);

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/handout/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingId }),
      });
      const j = (await res.json().catch(() => ({}))) as HandoutResponse & {
        error?: string; message?: string; chapters?: Chapter[]; title?: string;
      };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `${res.status}`);
        return;
      }
      // 路由直接返回 { title, chapters, markdown, model }
      const outline = j.outline ?? { title: j.title, chapters: j.chapters ?? [] };
      setData({
        outline,
        markdown: j.markdown,
        model: j.model,
        generatedAt: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async () => {
    await fetch(`/api/handout/${encodeURIComponent(recordingId)}`, { method: 'DELETE' }).catch(() => undefined);
    setData(null);
    await handleGenerate();
  };

  const handleCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const handleDownload = () => {
    if (!data) return;
    const blob = new Blob([data.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recordingId.slice(0, 8)}-handout.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  // 章节解构：outline 是 jsonb，可能形状不同
  const chapters: Chapter[] = (() => {
    if (!data) return [];
    const out = data.outline as { chapters?: Chapter[] } | undefined;
    return out?.chapters ?? [];
  })();
  const title = (() => {
    if (!data) return '';
    const out = data.outline as { title?: string } | undefined;
    return out?.title ?? '';
  })();

  if (!data) {
    return (
      <div
        className="mt-4 p-4"
        style={{
          background: 'var(--paper)',
          border: '1.4px solid var(--ink)',
          borderRadius: 3,
        }}
      >
        <div className="label-mono" style={{ fontSize: 11, marginBottom: 6 }}>
          {t('handoutTitle')}
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{t('handoutDesc')}</p>
        <button
          onClick={() => void handleGenerate()}
          disabled={busy}
          className="btn-sketch btn-sketch-primary mt-3 w-full"
          style={{ justifyContent: 'center' }}
        >
          {busy ? t('handoutGenerating') : t('handoutGenerate')}
        </button>
        {error && (
          <div
            className="mt-3 px-3 py-2"
            style={{
              background: 'var(--rec-soft)',
              border: '1.4px solid var(--rec)',
              borderRadius: 3,
              fontSize: 11.5,
              color: 'var(--rec)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-4 p-4"
      style={{
        background: 'var(--paper)',
        border: '1.4px solid var(--ink)',
        borderRadius: 3,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="label-mono" style={{ fontSize: 11 }}>
          {t('handoutTitle')}
        </div>
        <button
          onClick={() => void handleRegenerate()}
          disabled={busy}
          className="btn-sketch"
          style={{ padding: '5px 10px', fontSize: 10 }}
        >
          {busy ? t('handoutGenerating') : t('handoutRegenerate')}
        </button>
      </div>

      {title && (
        <h4 className="mt-3" style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          {title}
        </h4>
      )}

      <ol className="mt-3 space-y-2">
        {chapters.map((ch, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onJumpToTime?.(ch.startMs)}
              className="flex w-full items-start gap-3 px-2 py-2 text-left transition hover:bg-[var(--hi-soft)]"
              style={{
                border: '1.2px solid var(--rule-soft)',
                borderRadius: 3,
                background: 'var(--paper-2)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: 'var(--ink)',
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                  minWidth: 42,
                }}
              >
                {fmtTime(ch.startMs)}
              </span>
              <span className="min-w-0 flex-1">
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', display: 'block' }}>
                  {ch.title || '—'}
                </span>
                {ch.summary && (
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.45, display: 'block', marginTop: 2 }}>
                    {ch.summary}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex gap-2">
        <button onClick={handleDownload} className="btn-sketch btn-sketch-hi flex-1" style={{ justifyContent: 'center' }}>
          <I.Download size={13} /> {t('handoutDownload')}
        </button>
        <button onClick={() => void handleCopy()} className="btn-sketch flex-1" style={{ justifyContent: 'center' }}>
          {copied ? t('handoutCopied') : t('handoutCopy')}
        </button>
      </div>

      {data.generatedAt && (
        <div
          className="mt-3"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}
        >
          {t('handoutGeneratedAt', { date: new Date(data.generatedAt).toLocaleString() })}
        </div>
      )}

      {error && (
        <div
          className="mt-3 px-3 py-2"
          style={{
            background: 'var(--rec-soft)',
            border: '1.4px solid var(--rec)',
            borderRadius: 3,
            fontSize: 11.5,
            color: 'var(--rec)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
