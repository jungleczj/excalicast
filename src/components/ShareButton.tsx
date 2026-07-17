'use client';

import { useCallback, useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';
import { trackEvent } from '@/lib/analytics/track';
import { uploadRecording } from '@/services/cloudSync';
import { I } from '@/components/icons';
import { ShareLinkModal } from '@/components/ShareLinkModal';

interface Props {
  recordingId: string;
  isMax: boolean;
  onUpgrade: () => void;
}

/**
 * 分享按钮（顶栏会员标左侧）。Max 功能：生成分享链接 → ShareLinkModal；非 Max → 触发 Max 升级。
 * 逻辑从原 ExportPanel 高级卡片迁出，含「云端必需 → 保存到云端并重试」子流程（以按钮下方小浮层呈现）。
 */
export function ShareButton({ recordingId, isMax, onUpgrade }: Props): JSX.Element {
  const t = useTranslations('exportPanel');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState(0);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [needsCloud, setNeedsCloud] = useState(false);
  const [savingCloud, setSavingCloud] = useState(false);

  const createShareLink = useCallback(async () => {
    setShareBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/share/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingId }),
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; expiresAt?: number; error?: string; message?: string };
      if (!res.ok || !j.url) {
        if (j.error === 'cloud_recording_required') {
          setNeedsCloud(true);
          setMsg(j.message ?? 'cloud required');
        } else {
          setMsg(j.message ?? j.error ?? `share ${res.status}`);
        }
        return;
      }
      setNeedsCloud(false);
      setShareUrl(j.url);
      setShareExpiresAt(j.expiresAt ?? 0);
      setShareModalOpen(true);
      trackEvent('share_create', { recordingId });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'unknown');
    } finally {
      setShareBusy(false);
    }
  }, [recordingId]);

  const saveCloudThenShare = useCallback(async () => {
    setSavingCloud(true);
    setMsg(null);
    try {
      await uploadRecording(recordingId);
      setNeedsCloud(false);
      await createShareLink();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'upload_failed');
    } finally {
      setSavingCloud(false);
    }
  }, [recordingId, createShareLink]);

  const onClick = () => {
    trackEvent('feature_click', { feature: 'share', gated: !isMax });
    if (!isMax) { onUpgrade(); return; }
    void createShareLink();
  };

  return (
    <div className="relative">
      <button type="button" onClick={onClick} disabled={shareBusy} className="btn-sketch" style={{ padding: '7px 12px' }}>
        <I.Share size={13} /> {shareBusy ? t('shareCreating') : t('shareTitle')}
      </button>
      {msg && (
        <div
          className="share-button-craft-popover absolute right-0 top-[calc(100%+6px)] z-50 w-64 space-y-2 p-3"
          style={{ background: 'var(--paper)', border: '1.4px solid var(--rec)', borderRadius: 4, boxShadow: '3px 3px 0 var(--ink)' }}
        >
          <div className="share-button-craft-message" style={{ fontSize: 12, color: 'var(--rec)', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>{msg}</div>
          {needsCloud && (
            <button
              type="button"
              onClick={() => { void saveCloudThenShare(); }}
              disabled={savingCloud}
              className="btn-sketch btn-sketch-primary w-full"
              style={{ justifyContent: 'center' }}
            >
              {savingCloud ? t('savingToCloud') : t('saveToCloudAndRetry')}
            </button>
          )}
          <button
            type="button"
            onClick={() => { setMsg(null); setNeedsCloud(false); }}
            className="btn-sketch w-full"
            style={{ justifyContent: 'center', fontSize: 10 }}
          >
            ✕
          </button>
        </div>
      )}
      {shareUrl && (
        <ShareLinkModal open={shareModalOpen} url={shareUrl} expiresAt={shareExpiresAt} onClose={() => setShareModalOpen(false)} />
      )}
    </div>
  );
}
