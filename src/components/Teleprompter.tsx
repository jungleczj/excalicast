'use client';

/**
 * 提词器 —— 对标开源 Textream 的核心（智能跟读 + 高亮当前词）移植到网页：
 *  - 智能跟读：**离线 vosk-browser（WASM）** 实时识别，与录制**共用同一路麦克风 MediaStream**
 *    （拾音与识别解耦，解决 webkitSpeechRecognition 独占麦克风、录制时拿不到音频的硬伤）；
 *    用 Intl.Segmenter 切词、纯函数对齐讲稿（中文按字/西文按词），高亮当前词（实心块）+ 平滑前导滚动。
 *    模型懒加载（仅首次启用跟读下载，缓存），本地不传云、任意地区可用。
 *  - 刘海条停靠：顶部居中、可拖动/拉长的黑色窄条（Dynamic-Island 观感）；全屏时与刘海黑条无缝相连。
 *  - 常速滚动：非录制时兜底（速度可调）。透明度可调。弹出浮窗：Document PiP。
 * 私有浮层：`rb-no-record`（不进外壳快照）。识别本地运行，与千问字幕管线无关。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { I } from '@/components/icons';
import { buildScriptUnits, recognizedUnits, advanceUnitPointer, unitPointerToWordIndex } from '@/utils/teleprompterTracking';
import { DESKTOP_IPC_CHANNELS } from '@/desktop/productContract';
import type { DesktopTeleprompterState } from '@/desktop/teleprompterSession';

interface Props {
  open: boolean;
  onClose: () => void;
  en: boolean;
  /** 嵌入原生壳（Electron 刘海窗口）：铺满窗口、停靠态常驻，缩放/拖拽/关闭交给原生 `window.notchAPI`。 */
  embedded?: boolean;
  /** 录制中麦克风在线 → 自动开始跟读（"一个麦克风"：录制拾音同时驱动跟读）。 */
  autoFollow?: boolean;
  /** 录制麦克风流：传入则跟读与录制**共用同一路音频**（不抢占）；缺省时跟读自取麦克风。 */
  micStream?: MediaStream | null;
  /** Electron notch windows are display-only subscribers to the main renderer. */
  externalState?: DesktopTeleprompterState | null;
}

// 原生壳（Electron）桥接：刘海窗口的尺寸/关闭由原生侧控制。
interface NotchAPI { compact?: () => void; expand?: () => void; close?: () => void }
const notchAPI = (): NotchAPI | undefined => {
  if (typeof window === 'undefined') return undefined;
  if ((window as any).notchAPI) return (window as any).notchAPI;
  const bridge = (window as any).excalicastDesktop;
  if (!bridge) return undefined;
  const setMode = (mode: string) => { void bridge.invoke(DESKTOP_IPC_CHANNELS.teleprompterSetMode, { mode }); };
  return { compact: () => setMode('compact'), expand: () => setMode('expanded'), close: () => setMode('close') };
};

const LS = {
  text: 'excalicast.teleprompter.text',
  speed: 'excalicast.teleprompter.speed',
  font: 'excalicast.teleprompter.font',
  opacity: 'excalicast.teleprompter.opacity',
  pos: 'excalicast.teleprompter.pos',
  docked: 'excalicast.teleprompter.docked',
  lang: 'excalicast.teleprompter.lang',
  dockLeft: 'excalicast.teleprompter.dockLeft',
  dockW: 'excalicast.teleprompter.dockW',
};

const PANEL_W = 420;
const BODY_H = 240;
const DOCK_H = 36;
const hasVosk = typeof window !== 'undefined' && typeof (window as any).AudioContext !== 'undefined' && !!navigator?.mediaDevices?.getUserMedia;
const hasDocPiP = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const normW = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const defaultDockW = () => (typeof window !== 'undefined' ? Math.min(900, window.innerWidth - 32) : 720);

type LangPref = 'auto' | 'zh' | 'en';
// 识别语言按「讲稿内容」判定（CJK 占比），与 UI 语言无关；可手动覆盖（夹杂时定主语言）。
function detectLang(t: string): 'zh' | 'en' {
  const cjk = (t.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
  const lat = (t.match(/[A-Za-z]/g) || []).length;
  return cjk > 0 && cjk >= lat ? 'zh' : 'en';
}

// 切词（中英文）：返回 [{raw, isWord, n}]，raw 含分隔符段以便原样渲染。
function segmentWords(text: string, locale: string): { raw: string; isWord: boolean; n: string }[] {
  const Seg = (Intl as any).Segmenter;
  if (Seg) {
    try {
      const seg = new Seg(locale, { granularity: 'word' });
      const out: { raw: string; isWord: boolean; n: string }[] = [];
      for (const s of seg.segment(text)) {
        out.push({ raw: s.segment, isWord: !!s.isWordLike, n: s.isWordLike ? normW(s.segment) : '' });
      }
      return out;
    } catch { /* */ }
  }
  return text.split(/(\s+)/).map((tok) => ({ raw: tok, isWord: /\S/.test(tok), n: normW(tok) }));
}

type Mode = 'idle' | 'auto' | 'voice';
type VoiceStatus = 'off' | 'loading' | 'listening' | 'error' | 'fallback';

export function Teleprompter({ open, onClose, en, embedded = false, autoFollow = false, micStream = null, externalState = null }: Props): JSX.Element | null {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [speed, setSpeed] = useState(4);
  const [fontSize, setFontSize] = useState(28);
  const [opacity, setOpacity] = useState(0.92);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 40, y: 80 });
  const [docked, setDocked] = useState(false);
  const [langPref, setLangPref] = useState<LangPref>('auto');
  const [dockLeft, setDockLeft] = useState<number | null>(null);
  const [dockW, setDockW] = useState<number>(0); // 0 = 默认宽
  const [curWord, setCurWord] = useState(-1);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('off');
  const [heard, setHeard] = useState('');
  const [pipWin, setPipWin] = useState<Window | null>(null);
  const [isFs, setIsFs] = useState(false);

  const readerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const ptrRef = useRef(0);
  const posRef = useRef(pos); posRef.current = pos;
  const dockLeftRef = useRef(dockLeft); dockLeftRef.current = dockLeft;
  const dockWRef = useRef(dockW); dockWRef.current = dockW;
  const curWordRef = useRef(curWord); curWordRef.current = curWord;

  const scriptLang = langPref === 'auto' ? detectLang(text) : langPref;
  const words = useMemo(() => segmentWords(text, scriptLang), [text, scriptLang]);
  const scriptUnits = useMemo(() => buildScriptUnits(words), [words]);
  const scriptUnitsRef = useRef(scriptUnits); scriptUnitsRef.current = scriptUnits;

  const effectiveDocked = embedded ? !editing : (docked && !pipWin && !editing);
  const horizontal = effectiveDocked;

  useEffect(() => {
    try {
      setText(localStorage.getItem(LS.text) ?? '');
      const sp = localStorage.getItem(LS.speed); if (sp) setSpeed(clamp(Number(sp), 1, 10));
      const f = localStorage.getItem(LS.font); if (f) setFontSize(clamp(Number(f), 20, 48));
      const op = localStorage.getItem(LS.opacity); if (op) setOpacity(clamp(Number(op), 0.3, 1));
      const lg = localStorage.getItem(LS.lang); if (lg === 'auto' || lg === 'zh' || lg === 'en') setLangPref(lg);
      const dl = localStorage.getItem(LS.dockLeft); if (dl != null && dl !== '') setDockLeft(Number(dl));
      const dw = localStorage.getItem(LS.dockW); if (dw) setDockW(clamp(Number(dw), 240, 4000));
      const dk = localStorage.getItem(LS.docked);
      setDocked(dk == null ? isMac : dk === '1');
      const p = localStorage.getItem(LS.pos);
      if (p) setPos(JSON.parse(p));
      else setPos({ x: Math.round(window.innerWidth / 2 - PANEL_W / 2), y: isMac ? 8 : 80 });
    } catch { /* */ }
  }, []);
  useEffect(() => { if (open && !text && !embedded && !externalState) setEditing(true); /* eslint-disable-next-line */ }, [open, embedded, externalState]);

  useEffect(() => {
    if (!externalState) return;
    setText(externalState.script);
    setSpeed(externalState.speed);
    setFontSize(externalState.fontSize);
    setOpacity(externalState.opacity);
    setLangPref(externalState.language);
    setCurWord(externalState.currentWord);
    setHeard(externalState.heard);
    setVoiceStatus(externalState.recognitionStatus === 'idle' ? 'off' : externalState.recognitionStatus);
    setMode(externalState.mode === 'smart-readalong' ? 'voice' : 'auto');
    setEditing(false);
  }, [externalState]);

  // The main renderer owns recognition and publishes low-frequency state. The
  // embedded notch window is deliberately excluded to prevent a second mic request.
  useEffect(() => {
    if (embedded || typeof window === 'undefined') return;
    const bridge = (window as any).excalicastDesktop;
    if (!bridge) return;
    void bridge.invoke(DESKTOP_IPC_CHANNELS.teleprompterConfigure, {
      configuration: {
        schemaVersion: 1,
        visible: open,
        script: text,
        language: langPref,
        mode: mode === 'voice' ? 'smart-readalong' : 'constant-speed',
        dock: docked ? 'notch' : 'floating',
        microphoneSource: 'recording-session-pcm',
        fallback: 'constant-speed',
        excludeFromCapture: true,
        speed,
        fontSize,
        opacity,
      },
    });
  }, [docked, embedded, fontSize, langPref, mode, opacity, open, speed, text]);

  useEffect(() => {
    if (embedded || typeof window === 'undefined') return;
    const bridge = (window as any).excalicastDesktop;
    if (!bridge) return;
    void bridge.invoke(DESKTOP_IPC_CHANNELS.teleprompterConfigure, {
      progress: {
        currentWord: curWord,
        recognitionStatus: voiceStatus === 'off' ? 'idle' : voiceStatus,
        heard,
      },
    });
  }, [curWord, embedded, heard, voiceStatus]);
  useEffect(() => { try { localStorage.setItem(LS.text, text); } catch { /* */ } }, [text]);
  useEffect(() => { try { localStorage.setItem(LS.speed, String(speed)); } catch { /* */ } }, [speed]);
  useEffect(() => { try { localStorage.setItem(LS.font, String(fontSize)); } catch { /* */ } }, [fontSize]);
  useEffect(() => { try { localStorage.setItem(LS.opacity, String(opacity)); } catch { /* */ } }, [opacity]);
  useEffect(() => { try { localStorage.setItem(LS.docked, docked ? '1' : '0'); } catch { /* */ } }, [docked]);
  useEffect(() => { try { localStorage.setItem(LS.lang, langPref); } catch { /* */ } }, [langPref]);

  // 常速自动滚动（非录制兜底；停靠态横向滚，否则纵向）
  useEffect(() => {
    if (!open || editing || mode !== 'auto') return;
    let acc = 0;
    const tick = () => {
      const el = readerRef.current;
      if (el) {
        acc += speed * 0.12;
        const step = Math.floor(acc);
        if (step >= 1) { if (horizontal) el.scrollLeft += step; else el.scrollTop += step; acc -= step; }
        const done = horizontal
          ? el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
          : el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if (done) { setMode('idle'); return; }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [open, editing, mode, speed, horizontal]);

  // 智能跟读：离线 vosk-browser，喂入共用的 micStream（不抢占）。vosk 模块动态 import（懒加载，不进主包）。
  useEffect(() => {
    if (!open || editing || mode !== 'voice' || embedded) return;
    if (!hasVosk) { setVoiceStatus('error'); return; }
    let stopped = false;
    let handle: { stop: () => void } | null = null;
    let ownStream: MediaStream | null = null;
    ptrRef.current = 0; setCurWord(-1);
    setVoiceStatus('loading');

    (async () => {
      let stream = micStream ?? null;
      if (!stream) {
        try {
          ownStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
          stream = ownStream;
        } catch { setVoiceStatus('error'); setMode('idle'); return; }
      }
      if (stopped) { ownStream?.getTracks().forEach((t) => t.stop()); return; }

      const onText = (t: string) => {
        setHeard(t.slice(-28));
        const said = recognizedUnits(segmentWords(t, scriptLang));
        const next = advanceUnitPointer(scriptUnitsRef.current, said, ptrRef.current);
        if (next !== ptrRef.current) { ptrRef.current = next; setCurWord(unitPointerToWordIndex(scriptUnitsRef.current, next)); }
      };

      try {
        const { startReadalong } = await import('@/services/readalongEngine');
        if (stopped) { ownStream?.getTracks().forEach((t) => t.stop()); return; }
        handle = await startReadalong({
          stream,
          lang: scriptLang,
          onText,
          onStatus: (s) => setVoiceStatus(s),
        });
        if (stopped) handle.stop();
      } catch { setVoiceStatus('error'); }
    })();

    return () => {
      stopped = true;
      handle?.stop();
      ownStream?.getTracks().forEach((t) => t.stop());
      setVoiceStatus('off');
    };
    // scriptUnits 用 ref 读最新（编辑讲稿不重启识别）；语言/流变化才重启。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, mode, scriptLang, micStream]);

  // 当前词「平滑前导」滚动：rAF 缓动，当前词落在容器靠前处（后文常驻可见，缓解识别延迟）。
  useEffect(() => {
    if (mode !== 'voice') return;
    let raf = 0;
    const tick = () => {
      const el = readerRef.current;
      const i = curWordRef.current;
      if (el && i >= 0) {
        const target = el.querySelector(`[data-w="${i}"]`) as HTMLElement | null;
        if (target) {
          const cr = el.getBoundingClientRect();
          const tr = target.getBoundingClientRect();
          if (horizontal) {
            const center = (tr.left - cr.left) + el.scrollLeft + tr.width / 2;
            const dest = center - el.clientWidth * 0.30;
            el.scrollLeft += (dest - el.scrollLeft) * 0.2;
          } else {
            const center = (tr.top - cr.top) + el.scrollTop + tr.height / 2;
            const dest = center - el.clientHeight * 0.38;
            el.scrollTop += (dest - el.scrollTop) * 0.2;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, horizontal, pipWin]);

  useEffect(() => { if (mode !== 'voice') { ptrRef.current = 0; setCurWord(-1); } }, [mode]);

  // 一个麦克风：录制麦克风在线即自动进入跟读（声明式）；下线则退出。
  const prevAutoRef = useRef(false);
  useEffect(() => {
    if (open && autoFollow && hasVosk && text && mode !== 'voice' && voiceStatus !== 'error') setMode('voice');
    else if (!autoFollow && prevAutoRef.current && mode === 'voice') setMode('idle');
    prevAutoRef.current = autoFollow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFollow, open, text, mode, voiceStatus]);

  // 展开面板拖拽（停靠态/嵌入态不可拖）
  const startDrag = (e: React.MouseEvent) => {
    if (pipWin || effectiveDocked || embedded) return;
    e.preventDefault();
    const start = { mx: e.clientX, my: e.clientY, px: posRef.current.x, py: posRef.current.y };
    const onMove = (ev: MouseEvent) => {
      const nx = clamp(start.px + (ev.clientX - start.mx), 0, window.innerWidth - PANEL_W);
      const ny = clamp(start.py + (ev.clientY - start.my), 0, window.innerHeight - 120);
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem(LS.pos, JSON.stringify(posRef.current)); } catch { /* */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 刘海条拖动（移动）
  const startDockDrag = (e: React.MouseEvent) => {
    if (embedded || isFs) return;
    e.preventDefault(); e.stopPropagation();
    const w = dockWRef.current || defaultDockW();
    const startLeft = dockLeftRef.current ?? Math.round(window.innerWidth / 2 - w / 2);
    const sx = e.clientX;
    const onMove = (ev: MouseEvent) => setDockLeft(clamp(startLeft + (ev.clientX - sx), 0, window.innerWidth - w));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      try { if (dockLeftRef.current != null) localStorage.setItem(LS.dockLeft, String(dockLeftRef.current)); } catch { /* */ }
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };
  // 刘海条拉长（改宽度）
  const startDockResize = (e: React.MouseEvent) => {
    if (embedded || isFs) return;
    e.preventDefault(); e.stopPropagation();
    const startW = dockWRef.current || defaultDockW();
    const sx = e.clientX;
    const onMove = (ev: MouseEvent) => setDockW(clamp(startW + (ev.clientX - sx), 260, window.innerWidth - 16));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem(LS.dockW, String(dockWRef.current || defaultDockW())); } catch { /* */ }
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  // Document PiP 弹出 / 收回
  const togglePiP = async () => {
    if (pipWin) { try { pipWin.close(); } catch { /* */ } return; }
    if (!hasDocPiP) return;
    try {
      const w: Window = await (window as any).documentPictureInPicture.requestWindow({ width: PANEL_W, height: BODY_H + 90 });
      for (const node of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) {
        w.document.head.appendChild(node.cloneNode(true));
      }
      w.document.documentElement.style.cssText = document.documentElement.style.cssText;
      w.document.body.style.margin = '0';
      w.document.body.style.background = 'transparent';
      w.addEventListener('pagehide', () => setPipWin(null));
      setPipWin(w);
    } catch { /* 失败保持页内 */ }
  };
  useEffect(() => { if (!open && pipWin) { try { pipWin.close(); } catch { /* */ } } }, [open, pipWin]);

  // 全屏：macOS 全屏时刘海变黑条、页面内容落在刘海下方 —— 居中贴顶的黑条与之无缝相连。
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); }
      else { setDocked(true); setEditing(false); await document.documentElement.requestFullscreen(); }
    } catch { /* */ }
  };

  // 嵌入原生壳：编辑时请求放大窗口，否则收回刘海条尺寸。
  useEffect(() => {
    if (!embedded) return;
    const api = notchAPI();
    if (editing) api?.expand?.(); else api?.compact?.();
  }, [embedded, editing]);

  if (!open) return null;

  const btn = (active = false): React.CSSProperties => ({
    display: 'grid', placeItems: 'center', width: 24, height: 24,
    background: active ? 'var(--ok)' : 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 3, color: '#fff', cursor: 'pointer', fontSize: 11, lineHeight: 1,
  });
  const statusDot = voiceStatus === 'listening' ? { c: 'var(--ok)', t: en ? 'Listening' : '监听中' }
    : voiceStatus === 'loading' ? { c: 'var(--hi)', t: en ? 'Starting…' : '启动中…' }
    : voiceStatus === 'fallback' ? { c: 'var(--hi)', t: en ? 'Offline fallback…' : '离线回落中…' }
    : voiceStatus === 'error' ? { c: 'var(--rec)', t: en ? 'Recognition error' : '识别出错' }
    : null;

  const cycleLang = () => setLangPref((p) => (p === 'auto' ? 'zh' : p === 'zh' ? 'en' : 'auto'));
  const langLabel = langPref === 'auto' ? (en ? 'A' : '自') : langPref === 'zh' ? '中' : 'EN';
  const langTitle = en ? `Recognition: ${langPref === 'auto' ? 'auto' : langPref}` : `识别语言：${langPref === 'auto' ? '自动' : langPref === 'zh' ? '中文' : '英文'}`;

  const wordStyle = (i: number): React.CSSProperties => {
    if (mode !== 'voice') return { color: '#fff' };
    if (i === curWord) return {
      background: 'var(--hi)', color: '#111', borderRadius: 4, padding: '1px 4px',
      fontWeight: 800, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
    } as React.CSSProperties;
    if (i < curWord) return { color: 'rgba(255,255,255,0.32)' };
    return { color: '#fff' };
  };
  const renderWords = () => words.map((w, i) => w.isWord
    ? <span key={i} data-w={i} style={wordStyle(i)}>{w.raw}</span>
    : <span key={i}>{w.raw}</span>);

  // ── 刘海条（停靠态）──
  if (effectiveDocked) {
    const barW = dockW || defaultDockW();
    return (
      <>
      <div
        className="rb-no-record teleprompter-craft-dock"
        style={embedded ? {
          position: 'relative', width: '100%', height: DOCK_H,
          display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px 0 12px',
          background: '#000', color: '#fff', border: 'none', borderRadius: '0 0 16px 16px',
        } : {
          position: 'fixed', top: 'env(safe-area-inset-top, 0px)', zIndex: 60,
          ...(dockLeft != null ? { left: dockLeft, transform: 'none' } : { left: '50%', transform: 'translateX(-50%)' }),
          width: isFs ? 'min(900px, calc(100vw - 32px))' : barW, maxWidth: 'calc(100vw - 12px)',
          display: 'flex', alignItems: 'center', gap: 7, height: DOCK_H, padding: '0 14px 0 8px',
          background: isFs ? '#000' : `rgba(8,8,8,${Math.max(opacity, 0.85)})`, color: '#fff',
          border: isFs ? 'none' : '1.4px solid var(--ink)', borderTop: 'none',
          borderRadius: '0 0 16px 16px',
          boxShadow: isFs ? 'none' : '0 3px 12px rgba(0,0,0,0.5)',
        }}
      >
        {/* 移动手柄（拖动整条） */}
        {!embedded && !isFs && (
          <span onMouseDown={startDockDrag} title={en ? 'Drag to move' : '拖动移动'}
            style={{ cursor: 'move', color: 'rgba(255,255,255,0.4)', fontSize: 12, lineHeight: 1, userSelect: 'none', flexShrink: 0, padding: '0 1px' }}>⠿</span>
        )}
        {/* 智能跟读开关（Sparkles，非麦克风图标） */}
        {hasVosk && (
          <button type="button" style={{ ...btn(mode === 'voice'), width: 22, height: 22 }}
            onClick={() => { if (!externalState) setMode((m) => (m === 'voice' ? 'idle' : 'voice')); }}
            title={en ? 'Smart read-along' : '智能跟读'}><I.Sparkles size={12} /></button>
        )}
        {/* 语言 */}
        <button type="button" style={{ ...btn(langPref !== 'auto'), width: 22, height: 22, fontSize: 9, fontWeight: 700 }}
          onClick={() => { if (!externalState) cycleLang(); }} title={langTitle}>{langLabel}</button>
        {/* 状态点 */}
        {mode === 'voice' && statusDot && (
          <span title={statusDot.t} aria-label={statusDot.t}
            className={voiceStatus === 'listening' ? 'animate-pulse-soft' : ''}
            style={{ width: 8, height: 8, borderRadius: 999, background: statusDot.c, flexShrink: 0 }} />
        )}
        <div
          ref={readerRef}
          className="tp-noscroll"
          onClick={() => { if (!text) { setDocked(false); setEditing(true); } }}
          style={{
            flex: 1, minWidth: 120, overflowX: 'auto', whiteSpace: 'nowrap',
            fontSize: 15, fontWeight: 700, lineHeight: `${DOCK_H}px`, cursor: text ? 'default' : 'pointer',
            WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 7%, #000 93%, transparent 100%)',
            maskImage: 'linear-gradient(to right, transparent 0, #000 7%, #000 93%, transparent 100%)',
          }}
        >
          {text ? renderWords() : <span style={{ opacity: 0.55, fontSize: 12, fontWeight: 600 }}>{en ? 'Teleprompter · tap to add script' : '提词器 · 点此粘贴讲稿'}</span>}
        </div>
        {!autoFollow && (
          <button type="button" style={{ ...btn(mode === 'auto'), width: 22, height: 22 }}
            onClick={() => setMode((m) => (m === 'auto' ? 'idle' : 'auto'))}
            title={mode === 'auto' ? (en ? 'Pause' : '暂停') : (en ? 'Auto-scroll' : '常速滚动')}>
            {mode === 'auto' ? <I.Pause size={11} /> : <I.Play size={11} />}
          </button>
        )}
        <button type="button" style={{ ...btn(editing), width: 22, height: 22 }}
          onClick={() => { if (!externalState) { setEditing(true); setMode('idle'); } }} title={en ? 'Edit script' : '编辑讲稿'}><I.Pencil size={11} /></button>
        {!embedded && (
          <button type="button" style={{ ...btn(isFs), width: 22, height: 22 }}
            onClick={() => void toggleFullscreen()} title={isFs ? (en ? 'Exit fullscreen' : '退出全屏') : (en ? 'Fullscreen · seamless notch' : '全屏 · 无缝贴刘海')}>⛶</button>
        )}
        {!embedded && (
          <button type="button" style={{ ...btn(), width: 22, height: 22 }}
            onClick={() => setDocked(false)} title={en ? 'Expand' : '展开'}>▾</button>
        )}
        <button type="button" style={{ ...btn(), width: 22, height: 22 }}
          onClick={() => { if (embedded) notchAPI()?.close?.(); else onClose(); }} title={en ? 'Close' : '关闭'}>×</button>
        {/* 右边缘拉长手柄 */}
        {!embedded && !isFs && (
          <span onMouseDown={startDockResize} title={en ? 'Drag to resize width' : '拖动拉长'}
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} />
        )}
      </div>
      {/* 实时识别反馈：看得到字＝识别在工作；看不到＋状态非绿＝麦克风/模型问题 */}
      {!embedded && mode === 'voice' && (voiceStatus === 'listening' || voiceStatus === 'loading') && heard && (
        <div className="rb-no-record teleprompter-craft-heard" style={{
          position: 'fixed', top: `calc(env(safe-area-inset-top, 0px) + ${DOCK_H}px + 3px)`,
          ...(dockLeft != null ? { left: dockLeft, transform: 'none' } : { left: '50%', transform: 'translateX(-50%)' }),
          zIndex: 60, maxWidth: 'min(900px, calc(100vw - 24px))', background: 'rgba(8,8,8,0.82)', color: 'rgba(255,255,255,0.72)',
          fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 10px', borderRadius: '0 0 10px 10px', whiteSpace: 'nowrap', overflow: 'hidden',
        }}>
          {en ? 'heard: ' : '听到：'}{heard}
        </div>
      )}
      </>
    );
  }

  // ── 展开面板（页内 fixed 或 portal 进 PiP）──
  const panel = (
    <div
      style={{
        ...(pipWin || embedded ? { position: 'static', width: '100%' } : { position: 'fixed', left: pos.x, top: pos.y, width: PANEL_W, zIndex: 60, borderRadius: 6, boxShadow: '4px 4px 0 rgba(0,0,0,0.25)' }),
        background: `rgba(20,20,20,${opacity})`, border: '1.6px solid var(--ink)', overflow: 'hidden', color: '#fff',
      }}
      className="rb-no-record teleprompter-craft-panel"
    >
      <div onMouseDown={startDrag} className="flex items-center gap-1.5" style={{ padding: '6px 8px', cursor: (pipWin || embedded) ? 'default' : 'move', background: 'rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
        <I.Text size={13} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 'auto' }}>
          {en ? 'Teleprompter' : '提词器'}
        </span>
        {hasVosk && (
          <button type="button" style={btn(mode === 'voice')} onClick={(e) => { e.stopPropagation(); setMode((m) => (m === 'voice' ? 'idle' : 'voice')); }} title={en ? 'Smart read-along' : '智能跟读'}>
            <I.Sparkles size={12} />
          </button>
        )}
        <button type="button" style={{ ...btn(langPref !== 'auto'), fontSize: 9, fontWeight: 700 }} onClick={(e) => { e.stopPropagation(); cycleLang(); }} title={langTitle}>{langLabel}</button>
        {!autoFollow && (
          <button type="button" style={btn(mode === 'auto')} onClick={(e) => { e.stopPropagation(); setMode((m) => (m === 'auto' ? 'idle' : 'auto')); }} title={mode === 'auto' ? (en ? 'Pause' : '暂停') : (en ? 'Auto-scroll' : '常速滚动')}>
            {mode === 'auto' ? <I.Pause size={12} /> : <I.Play size={12} />}
          </button>
        )}
        <button type="button" style={btn()} onClick={(e) => { e.stopPropagation(); setFontSize((f) => clamp(f - 2, 20, 48)); }} title={en ? 'Smaller' : '小字'}>A−</button>
        <button type="button" style={btn()} onClick={(e) => { e.stopPropagation(); setFontSize((f) => clamp(f + 2, 20, 48)); }} title={en ? 'Larger' : '大字'}>A+</button>
        <button type="button" style={btn(editing)} onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); setMode('idle'); }} title={en ? 'Edit script' : '编辑讲稿'}><I.Pencil size={12} /></button>
        {embedded && (
          <button type="button" style={btn()} onClick={(e) => { e.stopPropagation(); setEditing(false); }} title={en ? 'Done · dock' : '完成 · 收起刘海'}>⤒</button>
        )}
        {!pipWin && !embedded && (
          <button type="button" style={btn()} onClick={(e) => { e.stopPropagation(); setEditing(false); setDocked(true); }} title={en ? 'Dock to notch (top)' : '吸附刘海（顶部）'}>⤒</button>
        )}
        {!pipWin && !embedded && (
          <button type="button" style={btn(isFs)} onClick={(e) => { e.stopPropagation(); void toggleFullscreen(); }} title={isFs ? (en ? 'Exit fullscreen' : '退出全屏') : (en ? 'Fullscreen · seamless notch' : '全屏 · 无缝贴刘海')}>⛶</button>
        )}
        {hasDocPiP && !embedded && (
          <button type="button" style={btn(!!pipWin)} onClick={(e) => { e.stopPropagation(); void togglePiP(); }} title={en ? 'Pop out (float on top)' : '弹出浮窗（置顶可拖到任意处）'}>⧉</button>
        )}
        <button type="button" style={btn()} onClick={(e) => { e.stopPropagation(); if (embedded) notchAPI()?.close?.(); else onClose(); }} title={en ? 'Close' : '关闭'}>×</button>
      </div>

      {/* 速度（非录制）+ 透明度滑块 */}
      {!editing && (
        <div className="flex items-center gap-2" style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          {!autoFollow && <>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, opacity: 0.7, width: 30 }}>{en ? 'SPEED' : '速度'}</span>
            <input type="range" min={1} max={10} step={1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--hi)' }} />
          </>}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, opacity: 0.7, width: 26 }}>{en ? 'OPAC' : '透明'}</span>
          <input type="range" min={30} max={100} step={5} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} style={{ flex: 1, accentColor: 'var(--hi)' }} />
        </div>
      )}

      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={en ? 'Paste your script here…' : '在此粘贴你的讲稿…'}
          autoFocus
          style={{ width: '100%', height: BODY_H, resize: 'none', padding: 12, background: 'transparent', color: '#fff', border: 'none', outline: 'none', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit' }}
        />
      ) : (
        <div ref={readerRef} onClick={() => setMode((m) => (m === 'auto' ? 'idle' : m))}
          style={{ height: BODY_H, overflowY: 'auto', padding: '12px 16px', cursor: 'pointer', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 16%, #000 84%, transparent 100%)', maskImage: 'linear-gradient(to bottom, transparent 0, #000 16%, #000 84%, transparent 100%)' }}>
          {text ? (
            <p style={{ fontSize, lineHeight: 1.6, fontWeight: 600, whiteSpace: 'pre-wrap', margin: 0 }}>
              {renderWords()}
            </p>
          ) : (
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: 0 }}>{en ? 'No script. Click the pencil to paste one.' : '还没有讲稿，点铅笔粘贴。'}</p>
          )}
        </div>
      )}

      {mode === 'voice' && statusDot && (
        <div className="flex items-center gap-1.5" style={{ padding: '4px 10px', background: 'rgba(0,0,0,0.3)', fontFamily: 'var(--font-mono)', fontSize: 9, color: '#fff' }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: statusDot.c }} className={voiceStatus === 'listening' ? 'animate-pulse-soft' : ''} />
          {statusDot.t}{heard && voiceStatus === 'listening' ? ` · ${heard}` : ''}
        </div>
      )}
    </div>
  );

  if (pipWin) return createPortal(panel, pipWin.document.body);
  return panel;
}
