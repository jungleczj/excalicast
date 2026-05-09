import Link from 'next/link';
import { I } from '@/components/icons';
import { Brand } from '@/components/AppHeader';

export const metadata = {
  title: 'Excalicast — 白板录制工具',
  description: '录制白板操作 + 麦克风音频，一次录制导出多种比例的 MP4 视频。',
};

export default function LandingPage(): JSX.Element {
  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Top nav (sticky inside the scroll area) */}
      <header className="flex-shrink-0 border-b border-border-default bg-bg-primary">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Brand />
          <nav className="flex items-center gap-6 text-[13px] font-medium text-text-secondary">
            <a href="#pricing" className="hover:text-text-primary">价格</a>
            <a href="#contact" className="hover:text-text-primary">联系我们</a>
            <Link href="/app" className="rounded-md bg-primary-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-primary-700">
              开始录制
            </Link>
          </nav>
        </div>
      </header>

      {/* Scrollable content area (body has overflow:hidden so we scroll inside main) */}
      <main className="flex-1 overflow-auto">

      {/* Hero */}
      <section
        className="relative overflow-hidden border-b border-border-default"
        style={{
          background: 'radial-gradient(ellipse at top, rgba(37,99,235,0.06), transparent 60%), var(--bg-secondary)',
        }}
      >
        {/* Decorative blurry blobs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-20 top-10 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--primary-300), transparent 70%)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-32 h-80 w-80 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--secondary-500), transparent 70%)' }}
        />

        <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-20 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-bg-primary px-3 py-1 text-[12px] font-medium text-text-secondary shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
            浏览器内运行 · 无需注册
          </span>
          <h1 className="mt-5 text-[44px] font-bold leading-[1.1] tracking-tight text-text-primary md:text-[60px]">
            录一次白板，<br />
            <span
              style={{
                backgroundImage: 'linear-gradient(135deg, var(--primary-600) 0%, var(--secondary-600) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              导出多个比例的视频
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[16.5px] leading-relaxed text-text-secondary">
            Excalicast 是一款基于浏览器的白板录制工具。用 Excalidraw 作画，同步采集语音和操作，
            最终导出 16:9 / 9:16 / 1:1 / 4:5 等多个比例的 MP4，覆盖 YouTube、抖音、Instagram 等平台。
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              href="/app"
              className="rounded-lg bg-primary-600 px-7 py-3 text-[15px] font-semibold text-white shadow-lg transition hover:bg-primary-700 hover:shadow-xl"
              style={{ boxShadow: '0 10px 25px -5px rgba(37,99,235,0.3)' }}
            >
              立即开始（免费）
            </Link>
            <a
              href="#pricing"
              className="rounded-lg border border-border-strong bg-bg-primary px-7 py-3 text-[15px] font-semibold text-text-primary transition hover:bg-bg-tertiary"
            >
              查看价格
            </a>
          </div>
          <p className="mt-5 text-[12.5px] text-text-tertiary">
            录制免费 · 导出含水印 MP4 免费 · 单条 $9.99 解锁无水印导出
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-[28px] font-bold text-text-primary">功能特色</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <Feature
            icon={<I.Edit size={20} />}
            title="无损录制"
            desc="基于操作事件流而非屏幕像素采集，画面始终清晰，不受窗口遮挡或最小化影响。"
          />
          <Feature
            icon={<I.Mic size={20} />}
            title="同步语音"
            desc="麦克风音频与白板操作严格同步，导出 MP4 含完整音轨。"
          />
          <Feature
            icon={<I.Crop size={20} />}
            title="一录多比例"
            desc="同一段录制，可分别导出横屏、竖屏、方形、4:5 多个比例。无需重录。"
          />
          <Feature
            icon={<I.Download size={20} />}
            title="本地渲染"
            desc="视频在浏览器内通过 ffmpeg.wasm 渲染，录制原始数据从不离开你的电脑。"
          />
          <Feature
            icon={<I.Camera size={20} />}
            title="可选人像浮窗"
            desc="开启摄像头后，画面叠加一个圆形头像浮窗，适合教学讲解场景。"
          />
          <Feature
            icon={<I.Lock size={20} />}
            title="隐私保护"
            desc="录制内容存储在你的浏览器（IndexedDB）。服务端只保存付款记录，不接触录制数据。"
          />
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-y border-border-default bg-bg-secondary">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-[28px] font-bold text-text-primary">价格</h2>
          <p className="mt-3 text-center text-[14px] text-text-secondary">
            录制和含水印导出免费。需要无水印导出时按单条录制单次付费。
          </p>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {/* Free tier */}
            <div className="rounded-2xl border border-border-default bg-bg-primary p-8">
              <div className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary">免费</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-[44px] font-bold leading-none text-text-primary">$0</span>
              </div>
              <p className="mt-2 text-[13px] text-text-secondary">无需注册，浏览器打开即用</p>

              <ul className="mt-6 space-y-2.5 text-[13.5px] text-text-secondary">
                <Bullet>无限次录制（最长 30 分钟）</Bullet>
                <Bullet>语音 + 摄像头浮窗</Bullet>
                <Bullet>导出 MP4 视频（带 Excalicast 水印）</Bullet>
                <Bullet>多比例导出（16:9 / 9:16 / 1:1 / 4:5）</Bullet>
              </ul>

              <Link href="/app" className="mt-8 block rounded-md border border-border-strong bg-bg-primary px-5 py-2.5 text-center text-[14px] font-semibold text-text-primary hover:bg-bg-tertiary">
                开始录制
              </Link>
            </div>

            {/* One-time tier */}
            <div
              className="relative rounded-2xl p-8 text-white shadow-xl"
              style={{ background: 'linear-gradient(135deg, var(--accent-500) 0%, var(--accent-600) 100%)' }}
            >
              <div className="absolute right-5 top-5 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">
                推荐
              </div>
              <div className="text-[13px] font-semibold uppercase tracking-wider opacity-80">单次解锁</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-[44px] font-bold leading-none">$9.99</span>
                <span className="text-[13px] opacity-80">/ 单条录制</span>
              </div>
              <p className="mt-2 text-[13px] opacity-90">仅这条录制永久解锁，无需账号</p>

              <ul className="mt-6 space-y-2.5 text-[13.5px]">
                <Bullet light>含免费档全部功能</Bullet>
                <Bullet light>导出永久去除水印</Bullet>
                <Bullet light>该录制可反复导出多个比例无水印 MP4</Bullet>
                <Bullet light>Paddle 安全支付（信用卡 / Apple Pay / Google Pay）</Bullet>
                <Bullet light>录制数据全程留在你浏览器，服务端只存付费状态</Bullet>
              </ul>

              <Link href="/app" className="mt-8 block rounded-md bg-white px-5 py-2.5 text-center text-[14px] font-semibold text-accent-600 shadow-md hover:bg-bg-secondary">
                录制后即可解锁
              </Link>
            </div>
          </div>

          <p className="mt-8 text-center text-[12px] text-text-tertiary">
            支持的支付方式：Visa · Mastercard · American Express · Apple Pay · Google Pay
            <br />
            所有交易由 <a href="https://www.paddle.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-text-primary">Paddle</a> 处理。Excalicast 不接触你的支付信息。
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-[28px] font-bold text-text-primary">使用流程</h2>
        <div className="mt-12 grid gap-10 md:grid-cols-3">
          <Step n={1} title="录制" desc="点击「开始录制」按钮，开始在白板上画图、写字，同时讲解。可以选择是否开启摄像头浮窗。" />
          <Step n={2} title="预览" desc="录制完成后跳转到导出页面，选择目标比例（16:9 横屏 / 9:16 竖屏 / 1:1 方形 / 4:5）。" />
          <Step n={3} title="下载" desc="点击「下载」直接生成含水印 MP4。或付费 $9.99 解锁该条录制的无水印导出，可反复使用。" />
        </div>
      </section>

      {/* Refund policy summary */}
      <section className="border-t border-border-default bg-bg-secondary">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-center text-[24px] font-bold text-text-primary">退款政策</h2>
          <p className="mt-4 text-center text-[14px] leading-relaxed text-text-secondary">
            如果支付后无法成功导出无水印 MP4，或对服务不满意，
            可在<strong className="text-text-primary">支付后 14 天内</strong>申请全额退款。
            发邮件到 <a href="mailto:hello@excalicast.app" className="font-semibold text-primary-600 hover:underline">hello@excalicast.app</a>
            ，我们会在 2 个工作日内回复处理。
          </p>
          <div className="mt-6 text-center">
            <Link href="/refund" className="text-[13px] font-semibold text-primary-600 hover:underline">
              查看完整退款政策 →
            </Link>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-[24px] font-bold text-text-primary">联系我们</h2>
        <p className="mt-4 text-[14px] leading-relaxed text-text-secondary">
          有问题、建议、合作意向，或退款申请，都可以发邮件给我们。我们会在 2 个工作日内回复。
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border-default bg-bg-primary px-5 py-3 font-mono text-[14px]">
          <I.Mail size={16} className="text-text-tertiary" />
          <a href="mailto:hello@excalicast.app" className="text-text-primary hover:underline">
            hello@excalicast.app
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border-default bg-bg-secondary">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 md:flex-row">
          <div className="flex items-center gap-3 text-[12px] text-text-tertiary">
            <Brand />
            <span>© 2026 Excalicast</span>
          </div>
          <nav className="flex flex-wrap gap-5 text-[12px] text-text-tertiary">
            <Link href="/" className="hover:text-text-primary">主页</Link>
            <Link href="/privacy" className="hover:text-text-primary">隐私政策</Link>
            <Link href="/terms" className="hover:text-text-primary">服务条款</Link>
            <Link href="/refund" className="hover:text-text-primary">退款政策</Link>
            <a href="mailto:hello@excalicast.app" className="hover:text-text-primary">联系我们</a>
          </nav>
        </div>
      </footer>

      </main>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="group rounded-xl border border-border-default bg-bg-primary p-6 transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md">
      <div
        className="grid h-10 w-10 place-items-center rounded-lg text-primary-700 transition group-hover:scale-105"
        style={{ background: 'linear-gradient(135deg, var(--primary-100), var(--primary-50))' }}
      >
        {icon}
      </div>
      <h3 className="mt-4 text-[16px] font-semibold text-text-primary">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">{desc}</p>
    </div>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary-600 text-[18px] font-bold text-white">
        {n}
      </div>
      <h3 className="mt-4 text-[16px] font-semibold text-text-primary">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">{desc}</p>
    </div>
  );
}

function Bullet({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <I.Check size={14} sw={2.5} className={`mt-0.5 flex-shrink-0 ${light ? 'text-white' : 'text-success-600'}`} />
      <span>{children}</span>
    </li>
  );
}
