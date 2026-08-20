'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { marked } from 'marked';
import { I } from '@/components/icons';
import { uploadRecording } from '@/services/cloudSync';
import { renderPreviewFrame } from '@/services/exportPipeline';
import { trackEvent } from '@/lib/analytics/track';
import { useMediaTasks } from '@/components/providers/MediaTaskProvider';
import { announceMediaTaskCreated, openMediaTaskCenter } from '@/components/MediaTaskCenter';
import { HandoutClientError, pollHandoutJob, submitHandoutJob } from '@/services/handoutClient';
import type { ExportConfig } from '@/types/recording';

interface Chapter {
  startMs: number;
  endMs: number;
  title: string;
  summary: string;
}

interface Keyframe {
  timeMs: number;
  label: string;
}

interface HandoutResponse {
  outline: { title?: string; chapters?: Chapter[]; keyframes?: Keyframe[] } | unknown;
  markdown: string;
  model?: string;
  generatedAt?: number;
}

interface Props {
  recordingId: string;
  /** 用于按录制比例渲染关键帧截图 */
  config: ExportConfig;
  /** 切换时使用：父组件可监听章节点击跳转预览时间 */
  onJumpToTime?: (ms: number) => void;
  /** outline=章节大纲（可点跳转）；handout=Markdown 文档+导出。缺省 handout。 */
  view?: 'outline' | 'handout';
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

const KEYFRAME_W = 640;
const KEYFRAME_JPEG_Q = 0.8;

async function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Task cancelled', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = window.setTimeout(finish, ms);
    const abort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Task cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function HandoutPanel({ recordingId, config, onJumpToTime, view = 'handout' }: Props): JSX.Element {
  const t = useTranslations('exportPanel');
  const [data, setData] = useState<HandoutResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [needsCloud, setNeedsCloud] = useState(false);
  const [savingCloud, setSavingCloud] = useState(false);
  const [withImages, setWithImages] = useState(true);
  // timeMs → JPEG dataURL
  const [keyframeImgs, setKeyframeImgs] = useState<Record<number, string>>({});
  const [renderingShots, setRenderingShots] = useState(false);
  const renderTokenRef = useRef(0);
  const { tasks, startTask } = useMediaTasks();
  const currentTask = tasks.find((task) => task.recordingId === recordingId && task.kind === 'handout');
  const busy = submitting || currentTask?.status === 'queued' || currentTask?.status === 'running';

  const loadHandout = useCallback(async (): Promise<void> => {
    const response = await fetch(`/api/handout/${encodeURIComponent(recordingId)}`, { cache: 'no-store' });
    if (response.status === 404) {
      setData(null);
      return;
    }
    if (!response.ok) throw new Error(`load ${response.status}`);
    setData(await response.json() as HandoutResponse);
  }, [recordingId]);

  // 初次加载，并接收离开当前 Tab 后由后台任务完成的通知。
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void loadHandout().catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'load_failed');
      });
    };
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent<{ recordingId?: string }>).detail;
      if (detail?.recordingId === recordingId) refresh();
    };
    refresh();
    window.addEventListener('excalicast:handout-ready', onReady);
    return () => {
      cancelled = true;
      window.removeEventListener('excalicast:handout-ready', onReady);
    };
  }, [loadHandout, recordingId]);

  const chapters: Chapter[] = (() => {
    if (!data) return [];
    const out = data.outline as { chapters?: Chapter[] } | undefined;
    return out?.chapters ?? [];
  })();
  const keyframes: Keyframe[] = (() => {
    if (!data) return [];
    const out = data.outline as { keyframes?: Keyframe[] } | undefined;
    return (out?.keyframes ?? []).filter((k) => typeof k?.timeMs === 'number');
  })();
  const title = (() => {
    if (!data) return '';
    const out = data.outline as { title?: string } | undefined;
    return out?.title ?? '';
  })();

  // 渲染关键帧截图（仅当带配图开关开 + 有 keyframes）。逐张异步渲染并降采样为 JPEG。
  useEffect(() => {
    if (!data || !withImages || keyframes.length === 0) return;
    const token = ++renderTokenRef.current;
    let cancelled = false;
    (async () => {
      setRenderingShots(true);
      const full = document.createElement('canvas');
      const small = document.createElement('canvas');
      try {
        for (const kf of keyframes) {
          if (cancelled || token !== renderTokenRef.current) return;
          if (keyframeImgs[kf.timeMs]) continue;
          try {
            await renderPreviewFrame(recordingId, kf.timeMs, config, full);
            const scale = full.width > 0 ? KEYFRAME_W / full.width : 1;
            small.width = Math.round(full.width * Math.min(1, scale));
            small.height = Math.round(full.height * Math.min(1, scale));
            const sctx = small.getContext('2d');
            if (!sctx) continue;
            sctx.drawImage(full, 0, 0, small.width, small.height);
            const url = small.toDataURL('image/jpeg', KEYFRAME_JPEG_Q);
            if (cancelled || token !== renderTokenRef.current) return;
            setKeyframeImgs((prev) => ({ ...prev, [kf.timeMs]: url }));
          } catch { /* 单帧失败忽略 */ }
        }
      } finally {
        if (!cancelled && token === renderTokenRef.current) setRenderingShots(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, withImages, recordingId]);

  const handleGenerate = async () => {
    if (busy) {
      openMediaTaskCenter(recordingId);
      return;
    }
    setSubmitting(true);
    setError(null);
    announceMediaTaskCreated(recordingId, document.activeElement);
    try {
      await startTask({
        recordingId,
        kind: 'handout',
        resourceClass: 'network',
        configSnapshot: { output: ['outline', 'handout'] },
      }, async (report, signal) => {
        const { jobId } = await submitHandoutJob(recordingId, signal);
        report({ phase: 'queued', ratio: 0.1, checkpoint: { remoteJobId: jobId } });
        for (let attempt = 0; attempt < 240; attempt += 1) {
          const status = await pollHandoutJob(jobId, signal);
          if (status.status === 'failed') throw new Error(status.error ?? 'handout_generation_failed');
          if (status.status === 'done') {
            report({ phase: 'saving', ratio: 0.98, checkpoint: { remoteJobId: jobId } });
            window.dispatchEvent(new CustomEvent('excalicast:handout-ready', { detail: { recordingId } }));
            return { resultRef: `handout:${recordingId}` };
          }
          report({
            phase: status.status === 'pending' ? 'queued' : 'generating',
            ratio: status.status === 'pending' ? 0.15 : 0.65,
            checkpoint: { remoteJobId: jobId },
          });
          await waitForPoll(2_500, signal);
        }
        throw new Error('handout_timeout');
      });
      setNeedsCloud(false);
      setKeyframeImgs({});
      await loadHandout();
      trackEvent('handout_generate', { recordingId });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setNeedsCloud(err instanceof HandoutClientError && err.code === 'cloud_recording_required');
        setError(err instanceof Error ? err.message : 'unknown');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 「保存到云端并重试」：就地上云后自动重试生成，免去回录制库
  const handleSaveCloudThenGenerate = async () => {
    setSavingCloud(true);
    setError(null);
    try {
      await uploadRecording(recordingId);
      setNeedsCloud(false);
      await handleGenerate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload_failed');
    } finally {
      setSavingCloud(false);
    }
  };

  const handleRegenerate = async () => {
    await fetch(`/api/handout/${encodeURIComponent(recordingId)}`, { method: 'DELETE' }).catch(() => undefined);
    setData(null);
    setKeyframeImgs({});
    await handleGenerate();
  };

  // 把关键帧图片织入 markdown：按章节标题就近插入，定位失败的归到文末「关键截图」画廊
  const assembleMarkdown = useCallback((): string => {
    if (!data) return '';
    let md = data.markdown;
    if (!withImages || keyframes.length === 0) return md;

    const imgBlock = (kf: Keyframe): string | null => {
      const url = keyframeImgs[kf.timeMs];
      if (!url) return null;
      const cap = kf.label ? `\n\n*${kf.label}*` : '';
      return `\n\n![${kf.label || 'keyframe'}](${url})${cap}\n`;
    };

    const leftover: Keyframe[] = [];
    // 按章节分组
    const perChapter = new Map<number, Keyframe[]>();
    for (const kf of keyframes) {
      if (!keyframeImgs[kf.timeMs]) continue;
      const idx = chapters.findIndex((c) => kf.timeMs >= c.startMs && kf.timeMs <= c.endMs);
      if (idx >= 0) {
        const arr = perChapter.get(idx) ?? [];
        arr.push(kf);
        perChapter.set(idx, arr);
      } else {
        leftover.push(kf);
      }
    }

    for (const [idx, kfs] of perChapter) {
      const chTitle = chapters[idx]?.title?.trim();
      const block = kfs.map(imgBlock).filter(Boolean).join('');
      if (!block) continue;
      let inserted = false;
      if (chTitle) {
        const lines = md.split('\n');
        for (let li = 0; li < lines.length; li++) {
          if (/^#{1,6}\s/.test(lines[li]) && lines[li].includes(chTitle)) {
            lines.splice(li + 1, 0, block);
            md = lines.join('\n');
            inserted = true;
            break;
          }
        }
      }
      if (!inserted) leftover.push(...kfs);
    }

    if (leftover.length > 0) {
      leftover.sort((a, b) => a.timeMs - b.timeMs);
      const gallery = leftover.map(imgBlock).filter(Boolean).join('');
      if (gallery) md += `\n\n## ${t('handoutKeyScreenshots')}\n${gallery}`;
    }
    return md;
  }, [data, withImages, keyframes, keyframeImgs, chapters, t]);

  const buildHtml = useCallback((): string => {
    const md = assembleMarkdown();
    const body = marked.parse(md, { async: false }) as string;
    const safeTitle = (title || 'Handout').replace(/[<>&]/g, '');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans CJK SC",sans-serif;line-height:1.7;color:#1a1a1a;max-width:760px;margin:40px auto;padding:0 20px;}
  h1{font-size:28px;} h2{font-size:20px;margin-top:1.6em;border-bottom:1px solid #eee;padding-bottom:.2em;}
  img{max-width:100%;height:auto;border:1px solid #e5e5e5;border-radius:6px;margin:.5em 0;}
  em{color:#666;font-size:13px;} p{margin:.6em 0;}
</style></head><body>${body}</body></html>`;
  }, [assembleMarkdown, title]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(assembleMarkdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const downloadFile = (content: string, ext: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recordingId.slice(0, 8)}-handout.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleExportMd = () => downloadFile(assembleMarkdown(), 'md', 'text/markdown');
  const handleExportHtml = () => downloadFile(buildHtml(), 'html', 'text/html');
  const handleExportPdf = () => {
    // 打印另存为 PDF：开新窗写入样式化 HTML，加载后触发打印，文字可选中、版式好。
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(buildHtml());
    w.document.close();
    const trigger = () => { try { w.focus(); w.print(); } catch { /* ignore */ } };
    if (w.document.readyState === 'complete') setTimeout(trigger, 300);
    else w.onload = () => setTimeout(trigger, 300);
  };

  // 某章节下的关键帧（用于章节列表里展示缩略图）
  const keyframesForChapter = (ch: Chapter): Keyframe[] =>
    keyframes.filter((kf) => kf.timeMs >= ch.startMs && kf.timeMs <= ch.endMs);

  if (!data) {
    return (
      <div
        className="handout-craft-panel mt-4 p-4"
        style={{ background: 'var(--paper)', border: '1.4px solid var(--ink)', borderRadius: 3 }}
      >
        <div className="label-mono" style={{ fontSize: 11, marginBottom: 6 }}>{t('handoutTitle')}</div>
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
            className="handout-craft-error mt-3 px-3 py-2"
            style={{ background: 'var(--rec-soft)', border: '1.4px solid var(--rec)', borderRadius: 3, fontSize: 11.5, color: 'var(--rec)', fontFamily: 'var(--font-mono)' }}
          >
            {error}
          </div>
        )}
        {needsCloud && (
          <button
            onClick={() => void handleSaveCloudThenGenerate()}
            disabled={savingCloud || busy}
            className="btn-sketch btn-sketch-primary mt-3 w-full"
            style={{ justifyContent: 'center' }}
          >
            {savingCloud ? t('savingToCloud') : t('saveToCloudAndRetry')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="handout-craft-panel mt-4 p-4"
      style={{ background: 'var(--paper)', border: '1.4px solid var(--ink)', borderRadius: 3 }}
    >
      <div className="flex items-center justify-between">
        <div className="label-mono" style={{ fontSize: 11 }}>{t('handoutTitle')}</div>
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

      {/* 带配图开关 */}
      <label className="mt-3 flex items-center gap-2" style={{ fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
        <input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} />
        {t('handoutWithImages')}
        {withImages && renderingShots && keyframes.length > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>
            {t('handoutRenderingShots')}
          </span>
        )}
      </label>

      {view === 'outline' && (
      <ol className="mt-3 space-y-2">
        {chapters.map((ch, i) => {
          const shots = withImages ? keyframesForChapter(ch) : [];
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onJumpToTime?.(ch.startMs)}
                className="handout-craft-outline-card flex w-full items-start gap-3 px-2 py-2 text-left transition hover:bg-[var(--hi-soft)]"
                style={{ border: '1.2px solid var(--rule-soft)', borderRadius: 3, background: 'var(--paper-2)' }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, color: 'var(--ink)', letterSpacing: '0.04em', flexShrink: 0, minWidth: 42 }}>
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
              {shots.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2 px-2">
                  {shots.map((kf) => (
                    <figure key={kf.timeMs} style={{ margin: 0, width: 150 }}>
                      {keyframeImgs[kf.timeMs] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={keyframeImgs[kf.timeMs]}
                          alt={kf.label || 'keyframe'}
                          style={{ width: '100%', borderRadius: 3, border: '1px solid var(--rule-soft)', display: 'block' }}
                        />
                      ) : (
                        <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 3, border: '1px dashed var(--rule-soft)', background: 'var(--paper-2)' }} />
                      )}
                      {kf.label && (
                        <figcaption style={{ fontSize: 10, color: 'var(--ink-3)', lineHeight: 1.3, marginTop: 2 }}>
                          {kf.label}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      )}

      {/* Handout 视图：Markdown 渲染预览 */}
      {view === 'handout' && (
        <div
          className="handout-craft-preview mt-3 px-3 py-2"
          style={{ maxHeight: 360, overflow: 'auto', background: 'var(--paper-2)', border: '1.2px solid var(--rule-soft)', borderRadius: 3, fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink)' }}
          // 内容来自自有讲义 API + 本地关键帧 dataURL，预览用途
          dangerouslySetInnerHTML={{ __html: marked.parse(assembleMarkdown(), { async: false }) as string }}
        />
      )}

      {/* 导出：Markdown / HTML / PDF + 复制（仅 Handout 视图） */}
      {view === 'handout' && (<>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button onClick={handleExportMd} className="btn-sketch btn-sketch-hi" style={{ justifyContent: 'center', fontSize: 11 }}>
          <I.Download size={12} /> {t('handoutExportMd')}
        </button>
        <button onClick={handleExportHtml} className="btn-sketch" style={{ justifyContent: 'center', fontSize: 11 }}>
          {t('handoutExportHtml')}
        </button>
        <button onClick={handleExportPdf} className="btn-sketch" style={{ justifyContent: 'center', fontSize: 11 }}>
          {t('handoutExportPdf')}
        </button>
      </div>
      <button onClick={() => void handleCopy()} className="btn-sketch mt-2 w-full" style={{ justifyContent: 'center', fontSize: 11 }}>
        {copied ? t('handoutCopied') : t('handoutCopy')}
      </button>
      </>)}

      {data.generatedAt && (
        <div className="handout-craft-meta mt-3" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {t('handoutGeneratedAt', { date: new Date(data.generatedAt).toLocaleString() })}
        </div>
      )}

      {error && (
        <div className="handout-craft-error mt-3 px-3 py-2" style={{ background: 'var(--rec-soft)', border: '1.4px solid var(--rec)', borderRadius: 3, fontSize: 11.5, color: 'var(--rec)', fontFamily: 'var(--font-mono)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
