'use client';

import { ASPECT_PRESETS, type AspectRatio, type CroppingMode, type ExportConfig } from '@/types/recording';

interface Props {
  config: ExportConfig;
  onChange: (next: ExportConfig) => void;
}

const RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];
const RATIO_HINT: Record<AspectRatio, string> = {
  '16:9': 'YouTube · B 站',
  '9:16': '抖音 · TikTok · Reels',
  '1:1':  'Instagram · 朋友圈',
  '4:5':  'Instagram 竖图',
};

const MODES: { value: CroppingMode; label: string; hint: string }[] = [
  { value: 'follow_viewport',  label: '跟随我的视口', hint: '镜头随用户当时看到的区域走' },
  { value: 'fit_all_content',  label: '自动套全部内容', hint: '所有元素的并集 bbox 静态展示' },
];

export function ExportRatioPicker({ config, onChange }: Props): JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-text-primary">比例</h3>
          <span className="text-[11px] text-text-tertiary">同一录制可分别导出多个比例</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {RATIOS.map((r) => {
            const preset = ASPECT_PRESETS[r];
            const active = config.aspectRatio === r;
            const max = Math.max(preset.width, preset.height);
            return (
              <button
                key={r}
                type="button"
                onClick={() => onChange({ ...config, aspectRatio: r })}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 transition ${
                  active
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-border-default bg-bg-primary text-text-secondary hover:bg-bg-tertiary'
                }`}
                style={{ borderWidth: active ? 1.5 : 1 }}
              >
                <div
                  className="rounded-sm border border-current"
                  style={{
                    width: 28 * (preset.width / max),
                    height: 28 * (preset.height / max),
                    minWidth: 8,
                    minHeight: 8,
                  }}
                />
                <span className="mt-0.5 text-[12px] font-semibold">{r}</span>
                <span className="text-[10px] text-text-tertiary">{RATIO_HINT[r]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-text-primary">框选模式</h3>
        <div className="space-y-2">
          {MODES.map((m) => {
            const active = config.croppingMode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => onChange({ ...config, croppingMode: m.value })}
                className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
                  active
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-border-default bg-bg-primary hover:bg-bg-tertiary'
                }`}
                style={{ borderWidth: active ? 1.5 : 1 }}
              >
                <span
                  className="mt-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded-full border-2"
                  style={{ borderColor: active ? 'var(--primary-600)' : 'var(--border-strong)' }}
                >
                  {active && <span className="h-2 w-2 rounded-full bg-primary-600" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-text-primary">{m.label}</div>
                  <div className="mt-0.5 text-[11px] text-text-tertiary">{m.hint}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
