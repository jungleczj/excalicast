import type { JSX } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ContentShell } from '@/components/content/ContentShell';
import { CtaRow, Lead, PageTitle, SectionHeading } from '@/components/content/ContentPieces';
import { JsonLd } from '@/components/seo/JsonLd';
import { pageMetadata } from '@/lib/seo/meta';
import { aboutPageSchema, brandGraphSchema } from '@/lib/seo/schema';
import { getActiveConfig } from '@/lib/paymentConfig';

interface Props {
  params: Promise<{ locale: string }>;
}

export const revalidate = 3600;

const COPY = {
  en: {
    title: 'About Excalicast',
    description: 'Excalicast is the browser-based visual explanation recorder at excalicast.cc.',
    lead: 'Excalicast is a browser-based recording and editing workflow for whiteboard explanations, lessons, product walkthroughs, and other visual communication.',
    identity: 'The official Excalicast web product is hosted at excalicast.cc. It records a built-in whiteboard as operations plus narration, and can also capture a selected browser tab, app window, or desktop as a screen source.',
    distinction: 'Excalicast is not the unrelated Excalicast podcast listed on Apple Podcasts. It is also not affiliated with the separate “ExcaliCast” iOS application promoted at excalicast.com. Similar names do not indicate shared ownership or endorsement.',
    boundary: 'Core recording and local rendering are designed to run in the browser. Network services are used only for features that need them, such as authentication, eligible AI-assisted outputs, cloud backup, or share links. Available features depend on the selected plan.',
    audience: 'Excalicast is built for teachers, architects, product teams, course creators, and anyone who needs to turn a visual explanation into reusable video and supporting material.',
  },
  zh: {
    title: '关于 Excalicast',
    description: 'Excalicast 是位于 excalicast.cc 的浏览器端视觉讲解录制工具。',
    lead: 'Excalicast 是面向白板讲解、课程、产品演示和其他视觉沟通场景的浏览器录制与编辑工作流。',
    identity: 'Excalicast Web 产品的唯一官网是 excalicast.cc。它把内置白板记录为操作流与旁白，也可以把用户选择的浏览器标签页、应用窗口或桌面作为屏幕来源进行采集。',
    distinction: 'Excalicast 与 Apple Podcasts 上的同名 Excalicast 播客无关，也不隶属于 excalicast.com 所介绍的独立 “ExcaliCast” iOS 应用。名称相似不代表共同所有权或相互背书。',
    boundary: '核心录制与本地渲染设计为在浏览器中运行。只有身份验证、支持套餐中的 AI 辅助输出、云备份或分享链接等需要联网的功能才会使用网络服务，实际能力取决于所选套餐。',
    audience: 'Excalicast 面向教师、架构师、产品团队、课程创作者，以及需要把视觉讲解转化为可复用视频和配套材料的人。',
  },
} as const;

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  return pageMetadata({ title: copy.title, description: copy.description, path: '/about', locale });
}

export default async function AboutPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const t = await getTranslations({ locale, namespace: 'landing' });
  const cfg = await getActiveConfig();
  const toMajor = (cents: number | undefined, fallback: number) => cents == null ? fallback : cents / 100;
  const brand = brandGraphSchema({
    locale,
    description: t('meta.description'),
    oneTimePrice: toMajor(cfg?.oneTimePriceCents, 4.99),
    proPrice: toMajor(cfg?.proMonthlyPriceCents, 9.99),
    maxPrice: toMajor(cfg?.maxMonthlyPriceCents, 15.99),
    currency: (cfg?.currency ?? 'usd').toUpperCase(),
  });

  return (
    <ContentShell locale={locale} contentType="pillar" slug="about">
      <JsonLd data={[brand, aboutPageSchema({ locale, name: copy.title, description: copy.description })]} />
      <PageTitle>{copy.title}</PageTitle>
      <Lead>{copy.lead}</Lead>

      <SectionHeading>{locale === 'zh' ? '产品与官网' : 'Product and official website'}</SectionHeading>
      <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--ink-2)' }}>{copy.identity}</p>

      <SectionHeading>{locale === 'zh' ? '同名实体说明' : 'Name disambiguation'}</SectionHeading>
      <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--ink-2)' }}>{copy.distinction}</p>
      <ul style={{ paddingLeft: 20, color: 'var(--ink-2)' }}>
        <li><a href="https://podcasts.apple.com/us/podcast/excalicast/id1368043138" rel="noreferrer" target="_blank">Apple Podcasts — Excalicast podcast</a></li>
        <li><a href="https://excalicast.com/" rel="noreferrer" target="_blank">excalicast.com iOS app</a></li>
      </ul>

      <SectionHeading>{locale === 'zh' ? '数据与功能边界' : 'Data and feature boundaries'}</SectionHeading>
      <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--ink-2)' }}>{copy.boundary}</p>

      <SectionHeading>{locale === 'zh' ? '服务对象' : 'Who it is for'}</SectionHeading>
      <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--ink-2)' }}>{copy.audience}</p>

      <CtaRow locale={locale} type="pillar" slug="about" />
    </ContentShell>
  );
}
