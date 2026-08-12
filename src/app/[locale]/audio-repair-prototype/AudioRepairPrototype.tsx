'use client';

import { useMemo, useState, type JSX } from 'react';
import { I, LogoMark } from '@/components/icons';
import styles from './audio-repair-prototype.module.css';

type Preset = 'natural' | 'clear' | 'studio';
type Audition = 'original' | 'repaired';

const PRESETS: Array<{
  id: Preset;
  name: string;
  note: string;
  color: string;
  repair: number;
  clarity: number;
  warmth: number;
  original: number;
}> = [
  { id: 'natural', name: '自然增强', note: '保留本人音色，轻修复与均衡', color: '#caead3', repair: 38, clarity: 32, warmth: 42, original: 72 },
  { id: 'clear', name: '清晰人声', note: '突出讲解内容，提升清晰度与响度', color: '#dbeeff', repair: 58, clarity: 70, warmth: 30, original: 48 },
  { id: 'studio', name: '录音棚修复', note: '更强去噪、破音修复与声音塑形', color: '#ffd873', repair: 78, clarity: 62, warmth: 56, original: 32 },
];

const REPAIRS = [
  { id: 'hiss', name: '去除沙沙声', detail: '持续高频底噪', detected: '中等', initial: true },
  { id: 'click', name: '修复爆点与裂纹', detail: '短促数字脉冲', detected: '发现 7 处', initial: true },
  { id: 'clip', name: '修复破音', detail: '削波与过载失真', detected: '轻微', initial: true },
  { id: 'hum', name: '去除电流声', detail: '50/60Hz 与谐波', detected: '未发现', initial: false },
  { id: 'ess', name: '减弱刺耳齿音', detail: 's / sh / x 高频瞬态', detected: '轻微', initial: true },
] as const;

function Waveform({ repaired }: { repaired: boolean }): JSX.Element {
  const bars = useMemo(() => Array.from({ length: 96 }, (_, index) => {
    const voice = Math.abs(Math.sin(index * 0.37) * Math.cos(index * 0.09));
    const transient = index === 19 || index === 51 || index === 72 ? 1 : 0;
    const base = repaired ? 0.12 : 0.24;
    return Math.min(1, base + voice * 0.66 + transient * (repaired ? 0.16 : 0.5));
  }), [repaired]);
  return (
    <div className={styles.waveform} aria-label={repaired ? '修复后波形' : '原声波形'}>
      <span className={styles.waveLabel}>{repaired ? '修复声' : '原声'}</span>
      <div className={styles.bars}>
        {bars.map((height, index) => <i key={index} style={{ height: `${Math.max(8, height * 88)}%` }} />)}
      </div>
      <span className={styles.playhead} />
    </div>
  );
}

export function AudioRepairPrototype(): JSX.Element {
  const [preset, setPreset] = useState<Preset>('natural');
  const [audition, setAudition] = useState<Audition>('repaired');
  const [playing, setPlaying] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [repairs, setRepairs] = useState<Record<string, boolean>>(
    Object.fromEntries(REPAIRS.map((item) => [item.id, item.initial])),
  );
  const selected = PRESETS.find((item) => item.id === preset) ?? PRESETS[0];
  const [repairStrength, setRepairStrength] = useState(selected.repair);
  const [clarity, setClarity] = useState(selected.clarity);
  const [warmth, setWarmth] = useState(selected.warmth);
  const [originalMix, setOriginalMix] = useState(selected.original);

  const choosePreset = (next: typeof PRESETS[number]) => {
    setPreset(next.id);
    setRepairStrength(next.repair);
    setClarity(next.clarity);
    setWarmth(next.warmth);
    setOriginalMix(next.original);
    setAudition('repaired');
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.iconButton} aria-label="返回导出页"><I.ChevronLeft size={17} /></button>
        <LogoMark size={28} />
        <div className={styles.project}>
          <span>// 原声修复样例</span>
          <strong>产品讲解 · 18:42</strong>
        </div>
        <span className={styles.prototypeTag}>PROTOTYPE</span>
      </header>

      <section className={styles.workspace}>
        <div className={styles.previewColumn}>
          <div className={styles.previewStage}>
            <div className={styles.videoFrame}>
              <div className={styles.videoChrome}><i /><i /><i /></div>
              <div className={styles.videoContent}>
                <span className={styles.videoEyebrow}>WHITEBOARD WALKTHROUGH</span>
                <strong>清晰的人声，<br />不该听起来像另一个人。</strong>
                <div className={styles.videoLine} />
              </div>
              <div className={styles.cameraBubble} />
            </div>
          </div>

          <div className={styles.auditionBar}>
            <button type="button" className={styles.playButton} onClick={() => setPlaying((value) => !value)}>
              {playing ? <I.Pause size={15} /> : <I.Play size={15} />}
              <span>{playing ? '暂停试听' : '播放试听'}</span>
            </button>
            <div className={styles.abControl} aria-label="原声与修复声对比">
              <button type="button" data-active={audition === 'original'} onClick={() => setAudition('original')}>A 原声</button>
              <button type="button" data-active={audition === 'repaired'} onClick={() => setAudition('repaired')}>B 修复声</button>
            </div>
            <div className={styles.listenStatus}>
              <span className={styles.liveDot} />
              正在试听：{audition === 'original' ? '未处理原声' : selected.name}
            </div>
            <span className={styles.time}>0:18 / 0:30</span>
          </div>

          <div className={styles.timeline}>
            <Waveform repaired={audition === 'repaired'} />
            <div className={styles.repairLane}>
              <span>原声修复</span>
              <div className={styles.repairClip}>去沙沙声 · 去裂纹 · 人声塑形</div>
            </div>
          </div>
        </div>

        <aside className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.kicker}>AUDIO REPAIR</span>
              <h1>修复并增强原声</h1>
            </div>
            <button type="button" className={styles.iconButton} aria-label="关闭"><I.Close size={16} /></button>
          </div>

          <section className={styles.diagnosis}>
            <div className={styles.diagnosisTop}>
              <span className={styles.score}>72</span>
              <div><strong>原声可修复</strong><p>检测到高频沙沙声、7 处短促裂纹和轻微削波。</p></div>
            </div>
            <div className={styles.metrics}>
              <span><i style={{ width: '62%' }} />底噪 <b>中等</b></span>
              <span><i style={{ width: '28%' }} />破音 <b>轻微</b></span>
              <span><i style={{ width: '44%' }} />清晰度 <b>可提升</b></span>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}><strong>选择声音方向</strong><span>随时可切回原声</span></div>
            <div className={styles.presets}>
              {PRESETS.map((item) => (
                <button key={item.id} type="button" className={styles.preset} data-selected={preset === item.id} onClick={() => choosePreset(item)}>
                  <span className={styles.presetSwatch} style={{ background: item.color }}>{preset === item.id && <I.Check size={14} />}</span>
                  <span><strong>{item.name}</strong><small>{item.note}</small></span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <button type="button" className={styles.detailsButton} onClick={() => setDetailsOpen((value) => !value)} aria-expanded={detailsOpen}>
              <span><strong>修复细节</strong><small>{Object.values(repairs).filter(Boolean).length} 项已启用</small></span>
              <I.ChevronDown size={15} className={detailsOpen ? styles.chevronOpen : ''} />
            </button>
            {detailsOpen && (
              <div className={styles.repairs}>
                {REPAIRS.map((item) => (
                  <label key={item.id} className={styles.repairRow}>
                    <input type="checkbox" checked={repairs[item.id]} onChange={(event) => setRepairs((value) => ({ ...value, [item.id]: event.target.checked }))} />
                    <span className={styles.fakeCheck}>{repairs[item.id] && <I.Check size={12} />}</span>
                    <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                    <em>{item.detected}</em>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}><strong>声音塑形</strong><span>非破坏性处理</span></div>
            {[
              ['修复强度', repairStrength, setRepairStrength],
              ['清晰度', clarity, setClarity],
              ['温暖度', warmth, setWarmth],
              ['保留原声', originalMix, setOriginalMix],
            ].map(([label, value, setter]) => (
              <label className={styles.sliderRow} key={String(label)}>
                <span>{String(label)}<b>{Number(value)}%</b></span>
                <input type="range" min="0" max="100" value={Number(value)} onChange={(event) => (setter as (value: number) => void)(Number(event.target.value))} />
              </label>
            ))}
          </section>

          <div className={styles.panelFooter}>
            <button type="button" className={styles.secondaryButton} onClick={() => setAudition('original')}><I.Undo size={14} />使用原声</button>
            <button type="button" className={styles.primaryButton}><I.Sparkles size={14} />应用修复与增强</button>
          </div>
          <p className={styles.privacy}>在你的设备上处理 · 原始音轨永久保留</p>
        </aside>
      </section>
    </main>
  );
}
