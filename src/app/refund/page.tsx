import { LegalLayout } from '@/components/LegalLayout';

export const metadata = {
  title: '退款政策 — Excalicast',
};

export default function RefundPage(): JSX.Element {
  return (
    <LegalLayout title="退款政策" lastUpdated="2026-05-08">
      <p>
        我们希望每一位用户都能获得满意的体验。如果你对购买的「单条录制无水印解锁」服务不满意，可在符合下列条件时申请全额退款。
      </p>

      <h2>1. 退款窗口</h2>
      <p>
        <strong>支付完成后 14 个自然日内</strong>可申请全额退款。
        超过 14 天我们一般不再受理退款请求，特殊情况（如系统故障导致服务无法使用）可来信沟通。
      </p>

      <h2>2. 适用情形</h2>
      <p>以下情况我们一定会批准退款：</p>
      <ul>
        <li>支付成功但服务端从未识别到付款（导致无法解锁无水印导出）</li>
        <li>导出过程中出现技术故障，无法获得目标 MP4</li>
        <li>对服务质量不满意（无需说明详细原因）</li>
        <li>误操作重复购买</li>
      </ul>

      <h2>3. 不适用情形</h2>
      <p>以下情况退款会被拒绝：</p>
      <ul>
        <li>支付超过 14 天</li>
        <li>同一用户在过去 90 天内有 2 次以上退款记录（防止滥用）</li>
        <li>录制内容明显违反{' '}
          <a href="/terms">服务条款</a>{' '}
          的使用规范，已被我们终止访问</li>
      </ul>

      <h2>4. 申请方式</h2>
      <p>发邮件到{' '}
        <a href="mailto:hello@excalicast.app">hello@excalicast.app</a>，
        在邮件中提供：
      </p>
      <ul>
        <li>付款时使用的电子邮箱</li>
        <li>Paddle 收据中的交易编号（形如 <code>txn_01...</code>）</li>
        <li>退款原因（一句话即可，便于我们改进）</li>
      </ul>
      <p>无需填表，无需电话确认。</p>

      <h2>5. 处理时效</h2>
      <ul>
        <li>我们一般在 <strong>2 个工作日内回复</strong>。</li>
        <li>批准后由 Paddle 发起退款，原路返回到你的支付方式。</li>
        <li>
          款项实际到账时间由发卡行决定，通常为：
          <ul>
            <li>信用卡：5–10 个工作日</li>
            <li>Apple Pay / Google Pay：5–10 个工作日</li>
            <li>本地支付方式（如部分国家的银行转账）：可能更长</li>
          </ul>
        </li>
      </ul>

      <h2>6. 退款后的服务状态</h2>
      <p>
        退款获批后，对应录制的"无水印解锁"权益<strong>立即失效</strong>。
        但你之前已经下载到本地的 MP4 文件不受影响，依然可以使用。
      </p>

      <h2>7. 联系我们</h2>
      <p>
        关于退款的任何问题，请联系{' '}
        <a href="mailto:hello@excalicast.app">hello@excalicast.app</a>。
      </p>
    </LegalLayout>
  );
}
