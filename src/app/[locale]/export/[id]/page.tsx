'use client';

import { useEffect, useState, useCallback, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ExportRatioPicker } from '@/components/ExportRatioPicker';
import { ExportFormatPanel } from '@/components/ExportFormatPanel';
import { ExportPreview } from '@/components/ExportPreview';
import { ExportPanel, type ExportProgressState } from '@/components/ExportPanel';
import { WorkspaceShellToggle } from '@/components/WorkspaceShellToggle';
import { SubtitlePanel } from '@/components/SubtitlePanel';
import { HandoutPanel } from '@/components/HandoutPanel';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';
import { Timeline } from '@/components/editor/Timeline';
import { I, LogoMark } from '@/components/icons';
import { TierBadge } from '@/components/TierBadge';
import { ShareButton } from '@/components/ShareButton';
import { useSubscription } from '@/hooks/useSubscription';
import { getRecording, deleteRecording, updateRecordingTitle, updateRecordingSegments } from '@/lib/db-client';
import { getCurrentOwnerKey } from '@/lib/ownerKey';
import type { AspectRatio, ExportConfig, RecordingMetadata, RecordingSetupConfig, TimeSegment } from '@/types/recording';
import { ASPECT_PRESETS } from '@/types/recording';
import { normalizeSegments, isTrimmed } from '@/utils/segments';
import { Link, useRouter } from '@/i18n/navigation';

const DEFAULT_CONFIG: ExportConfig = {
  aspectRatio: '16:9',
  croppingMode: 'follow_viewport',
  fps: 15,
  withWatermark: true,
};

/** 自定义 W×H → 最接近的预设比例（ExportConfig.aspectRatio 只接受预设）。 */
function nearestPreset(w: number, h: number): AspectRatio {
  if (!w || !h) return '16:9';
  const target = w / h;
  let best: AspectRatio = '16:9';
  let bestDiff = Infinity;
  for (const [id, p] of Object.entries(ASPECT_PRESETS) as [AspectRatio, (typeof ASPECT_PRESETS)[AspectRatio]][]) {
    const diff = Math.abs(p.width / p.height - target);
    if (diff < bestDiff) { bestDiff = diff; best = id; }
  }
  return best;
}

/** 录制前 Setup 配置 → 导出默认（沿用比例 / 裁切模式 / 含工作区 / 裁切框）。 */
function exportDefaultsFromSetup(setup: RecordingSetupConfig): ExportConfig {
  const base: ExportConfig = { ...DEFAULT_CONFIG, includeWorkspaceShell: setup.includeWorkspaceShell };
  if (setup.framing === 'default') {
    return { ...base, aspectRatio: '16:9', croppingMode: 'fit_all_content' };
  }
  if (setup.framing === 'custom') {
    const out = setup.customOutput;
    return {
      ...base,
      aspectRatio: nearestPreset(out?.width ?? 16, out?.height ?? 9),
      croppingMode: 'follow_viewport',
      cropWindow: setup.cropWindow,
      customOutput: out,
    };
  }
  return { ...base, aspectRatio: setup.framing, croppingMode: 'follow_viewport', cropWindow: setup.cropWindow };
}

type Tab = 'export' | 'captions' | 'outline' | 'handout';

export default function EditorRecordingPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const locale = useLocale();
  const en = locale === 'en';
  const subscription = useSubscription();
  const isPro = subscription.tier === 'pro' || subscription.tier === 'max';
  const isMax = subscription.tier === 'max';

  const [meta, setMeta] = useState<RecordingMetadata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<ExportConfig>(DEFAULT_CONFIG);
  const [exportProgress, setExportProgress] = useState<ExportProgressState | null>(null);
  const [paymentDone, setPaymentDone] = useState(false);
  const [tab, setTab] = useState<Tab>('export');
  const [title, setTitle] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState<false | 'pro' | 'max'>(false);
  // 时间轴裁剪：保留段（源 ms）+ 播放头源时间
  const [segments, setSegments] = useState<TimeSegment[]>([]);
  const [playheadMs, setPlayheadMs] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (!sp.get('creem_purchase')) return;
    setPaymentDone(true);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    const tid = setTimeout(() => setPaymentDone(false), 6000);
    return () => clearTimeout(tid);
  }, []);

  useEffect(() => {
    if (!id) return;
    getCurrentOwnerKey()
      .then((ownerKey) => getRecording(id, ownerKey))
      .then((m) => {
        if (!m) setLoadError(en ? `Recording not found: ${id}` : `录制不存在：${id}`);
        else {
          setMeta(m);
          setTitle(m.title?.trim() || (en ? `Recording ${id.slice(0, 8)}` : `录制 ${id.slice(0, 8)}`));
          if (m.setup) setConfig(exportDefaultsFromSetup(m.setup));
          setSegments(normalizeSegments(m.segments, m.durationMs));
          setPlayheadMs(0);
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'load_failed'));
  }, [id, en]);

  const handlePaidChange = useCallback((isPaidNow: boolean) => {
    if (isPaidNow) setConfig((c) => ({ ...c, withWatermark: false }));
  }, []);

  const handleConfigChange = useCallback((next: ExportConfig) => {
    setConfig((prev) => {
      if (next.aspectRatio !== prev.aspectRatio && meta?.setup?.framing !== next.aspectRatio) {
        return { ...next, cropWindow: undefined, customOutput: undefined };
      }
      return next;
    });
  }, [meta]);

  const commitTitle = useCallback(() => {
    if (!id) return;
    void updateRecordingTitle(id, title);
  }, [id, title]);

  // 保留段 → 同步进 config.segments（导出用）+ 去抖持久化到 recording.segments
  useEffect(() => {
    if (!meta) return;
    const trimmed = isTrimmed(segments, meta.durationMs);
    const segs = trimmed ? segments : undefined;
    setConfig((c) => (JSON.stringify(c.segments) === JSON.stringify(segs) ? c : { ...c, segments: segs }));
    const tid = setTimeout(() => { void updateRecordingSegments(id, trimmed ? segments : []); }, 500);
    return () => clearTimeout(tid);
  }, [segments, meta, id]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    if (!confirm(en ? 'Delete this recording? Cannot be undone.' : '删除这条录制？此操作不可恢复。')) return;
    await deleteRecording(id, await getCurrentOwnerKey());
    router.push('/library');
  }, [id, router, en]);

  if (loadError) {
    return (
      <Shell>
        <div className="grid flex-1 place-items-center">
          <div className="px-8 py-6 text-center" style={CARD}>
            <p style={{ fontSize: 13, color: 'var(--rec)', fontFamily: 'var(--font-mono)' }}>{loadError}</p>
            <Link href="/library" className="mt-4 inline-block" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)', borderBottom: '1.5px solid var(--ink)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {en ? 'Back to library' : '返回录制库'}
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (!meta) {
    return (
      <Shell>
        <div className="grid flex-1 place-items-center" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {en ? 'Loading recording…' : '加载录制…'}
        </div>
      </Shell>
    );
  }


  const exportTab = (
    <div className="space-y-5">
      <WorkspaceShellToggle recordingId={id} config={config} onChange={handleConfigChange} />
      <ExportRatioPicker config={config} onChange={handleConfigChange} />
      <ExportFormatPanel config={config} onChange={setConfig} en={en} />
      <div style={{ height: 1.5, background: 'var(--ink)', opacity: 0.4 }} />
      <ExportPanel recordingId={id} config={config} onConfigChange={setConfig} onPaidStateChange={handlePaidChange} onProgress={setExportProgress} />
    </div>
  );

  const lockBlock = (target: 'pro' | 'max', title2: string, desc: string) => (
    <div style={{ ...CARD, padding: 22 }} className="text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center" style={{ background: target === 'max' ? 'var(--max)' : 'var(--pro)', border: '1.6px solid var(--ink)', borderRadius: 4, boxShadow: '3px 3px 0 var(--ink)' }}>
        <I.Lock size={20} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{title2}</div>
      <p className="mt-2" style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{desc}</p>
      <button type="button" className="btn-sketch btn-sketch-primary mt-4" onClick={() => setUpgradeOpen(target)}>
        <I.Sparkles size={13} /> {en ? `Upgrade to ${target.toUpperCase()}` : `升级 ${target.toUpperCase()}`}
      </button>
    </div>
  );

  const tabContent = (() => {
    if (tab === 'captions') return isPro ? <SubtitlePanel open recordingId={id} /> : lockBlock('pro', en ? 'Captions are a Pro feature' : '字幕是 Pro 功能', en ? 'Generate accurate subtitles from your audio.' : '从音频生成精准字幕。');
    if (tab === 'outline') return isMax ? <HandoutPanel view="outline" recordingId={id} config={config} onJumpToTime={setPlayheadMs} /> : lockBlock('max', en ? 'Outline is a Max feature' : '大纲是 Max 功能', en ? 'Auto chapters with jump-to-time.' : '自动识别章节、点击跳转预览。');
    if (tab === 'handout') return isMax ? <HandoutPanel view="handout" recordingId={id} config={config} /> : lockBlock('max', en ? 'Handout is a Max feature' : '讲义是 Max 功能', en ? 'Markdown handout — download / copy.' : '生成 Markdown 讲义，可下载 / 复制。');
    return exportTab;
  })();

  const tabs: { id: Tab; label: string }[] = [
    { id: 'export', label: en ? 'Export' : '导出' },
    { id: 'captions', label: en ? 'Captions' : '字幕' },
    { id: 'outline', label: en ? 'Outline' : '大纲' },
    { id: 'handout', label: en ? 'Handout' : '讲义' },
  ];

  return (
    <Shell>
      {/* Editor top bar */}
      <div className="editor-craft-topbar flex h-14 flex-shrink-0 items-center gap-3 px-4 sm:px-6" style={{ borderBottom: '1.8px solid var(--ink)', background: 'var(--paper)' }}>
        <Link href="/library" className="editor-craft-back grid h-8 w-8 place-items-center" style={{ border: '1.4px solid var(--ink)', background: 'var(--paper)', borderRadius: 3, color: 'var(--ink)' }} aria-label={en ? 'Back' : '返回'}>
          <I.ChevronLeft size={14} />
        </Link>
        <LogoMark size={26} />
        <div className="hidden h-5 sm:block" style={{ width: 1.5, background: 'var(--ink)', opacity: 0.4 }} />
        <div className="min-w-0 flex-1">
          <div className="label-mono" style={{ fontSize: 8.5 }}>// {en ? 'PROJECT' : '项目'}</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            maxLength={80}
            className="w-full max-w-[420px] truncate bg-transparent outline-none"
            style={{ border: 'none', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}
          />
        </div>
        <ShareButton recordingId={id} isMax={isMax} onUpgrade={() => setUpgradeOpen('max')} />
        <TierBadge tier={subscription.tier} />
      </div>

      {paymentDone && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 px-4 py-2" style={{ background: 'var(--ok, #1a7f37)', color: '#fff', border: '1.4px solid var(--ink)', borderRadius: 4, boxShadow: '3px 3px 0 var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {en ? 'Payment received · unlocked' : '支付完成 · 已解锁'}
        </div>
      )}

      <div className="editor-craft-body flex flex-1 overflow-hidden">
        {/* Left: player + timeline */}
        <div className="editor-craft-main flex flex-1 flex-col overflow-auto p-6" style={{ borderRight: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
          {/* 预览 + 时间轴 + 删除 共用全宽列：填满左列、两者等宽对齐 */}
          <div className="flex w-full flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center">
            <div className="editor-craft-card editor-craft-preview-shell w-full" style={{ ...CARD, padding: 0 }}>
              <ExportPreview
                recordingId={id}
                metadata={meta}
                config={config}
                progress={exportProgress}
                segments={segments}
                playheadMs={playheadMs}
                onPlayheadChange={setPlayheadMs}
              />
            </div>
          </div>

          {/* Timeline — 主流剪辑交互：播放头 scrub + Split + 选段删除 + 边缘 Trim */}
          <div className="mt-5">
            <Timeline
              durationMs={meta.durationMs}
              clips={segments}
              playheadMs={playheadMs}
              onScrub={setPlayheadMs}
              onChange={(next) => setSegments(next.length ? next : segments)}
              onReset={() => setSegments(normalizeSegments(undefined, meta.durationMs))}
              hasAudio={meta.hasAudio}
              hasCaptions={!!meta.subtitleSrt}
              labels={{
                edit: en ? 'Edit' : '剪辑',
                reset: en ? 'Reset' : '复原',
                kept: en ? 'Kept' : '保留',
                mic: en ? 'Mic' : '麦克风',
                captions: en ? 'Captions' : '字幕',
                split: en ? 'Split' : '切一刀',
                deleteClip: en ? 'Delete' : '删片段',
                hint: en
                  ? 'Drag playhead/edges to scrub · Split (S) then Delete to cut any part'
                  : '拖播放头/边缘实时预览 · 切一刀(S)后删片段即可剪掉任意段',
              }}
            />
          </div>

          <div className="mt-4 flex justify-end">
            <button onClick={handleDelete} className="editor-craft-delete btn-sketch" style={{ padding: '7px 12px', fontSize: 10, color: 'var(--rec)', borderColor: 'var(--rec)' }}>
              <I.Trash size={12} /> {en ? 'Delete recording' : '删除录制'}
            </button>
          </div>
          </div>
        </div>

        {/* Right: tabbed panel */}
        <aside className="editor-craft-side flex-shrink-0 overflow-y-auto p-6" style={{ width: 420, background: 'var(--paper)' }}>
          <div className="editor-craft-tabs mb-5 flex gap-1" style={{ borderBottom: '1.5px solid var(--ink)' }}>
            {tabs.map((tb) => {
              const active = tab === tb.id;
              return (
                <button
                  key={tb.id}
                  type="button"
                  data-active={active}
                  onClick={() => setTab(tb.id)}
                  className="press"
                  style={{
                    padding: '8px 12px', marginBottom: -1.5,
                    background: active ? 'var(--hi)' : 'transparent',
                    border: active ? '1.4px solid var(--ink)' : '1.4px solid transparent',
                    borderBottom: active ? 'none' : '1.4px solid transparent',
                    borderRadius: '3px 3px 0 0',
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: 'var(--ink)', cursor: 'pointer',
                  }}
                >
                  {tb.label}
                </button>
              );
            })}
          </div>
          {/* 切 Tab 内容淡入（key 变化重新触发入场） */}
          <div key={tab} className="fade-in">{tabContent}</div>
        </aside>
      </div>

      <ProUpgradeModal
        open={!!upgradeOpen}
        tier={upgradeOpen === 'max' ? 'max' : 'pro'}
        onClose={() => setUpgradeOpen(false)}
        onUpgraded={() => { setUpgradeOpen(false); void subscription.refresh(); }}
      />
    </Shell>
  );
}

const CARD: React.CSSProperties = {
  background: '#fffdf8', border: '1px solid rgba(24,25,26,0.08)', borderRadius: 28, boxShadow: '0 14px 36px rgba(48,38,26,0.09), inset 0 1px 0 rgba(255,255,255,0.74)',
};

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="app-craft-screen editor-craft-shell flex h-full flex-col" style={{ background: 'var(--paper-2)' }}>{children}</div>;
}
