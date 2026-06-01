import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';

/**
 * Dynamic OpenGraph/Twitter card (1200×630). Next auto-attaches this image to
 * og:image / twitter:image for every route under [locale]. Code-generated in
 * the brand's paper/ink hand-drawn palette — no design asset needed.
 */
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Excalicast — Whiteboard Recorder';

// 品牌色（来自 globals.css）
const PAPER = '#FBFBFA';
const INK = '#1A1A1A';
const REC = '#DC2626';
const HI = '#FFD166';

export default async function Image({ params }: { params: { locale: string } }) {
  const { locale } = params;
  const t = await getTranslations({ locale, namespace: 'landing' });
  const tagline = t('hero.subtitle');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: PAPER,
          color: INK,
          padding: '72px 80px',
          border: `16px solid ${INK}`,
          fontFamily: 'sans-serif',
        }}
      >
        {/* 顶部：REC 红点 + 标签 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: REC }} />
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: INK,
            }}
          >
            Whiteboard Recorder
          </div>
        </div>

        {/* 中部：产品名 + 一句话定位 */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 104, fontWeight: 800, letterSpacing: -3 }}>
            Excalicast
            <span style={{ color: REC, marginLeft: 8 }}>.</span>
          </div>
          <div
            style={{
              marginTop: 24,
              fontSize: 34,
              lineHeight: 1.35,
              color: '#3A3A38',
              maxWidth: 980,
              display: 'flex',
            }}
          >
            {tagline.length > 150 ? tagline.slice(0, 147) + '…' : tagline}
          </div>
        </div>

        {/* 底部：比例徽标 + 域名 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {['16:9', '9:16', '1:1', '4:5'].map((r) => (
              <div
                key={r}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 24,
                  fontWeight: 700,
                  padding: '10px 18px',
                  background: HI,
                  border: `3px solid ${INK}`,
                  borderRadius: 10,
                }}
              >
                {r}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: INK }}>excalicast.cc</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
