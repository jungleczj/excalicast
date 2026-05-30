export function RefundZh(): JSX.Element {
  return (
    <>
      <p>
        「单条录制无水印解锁」是一次性数字商品，付款成功后<strong>即时解锁并交付</strong>无水印导出权益。
        由于商品在交付那一刻即被消费，该笔购买<strong>不支持退款</strong>。
      </p>

      <h2>1. 单次导出不退款</h2>
      <p>
        一旦付款成功并为你的录制开通无水印解锁，该笔购买将无法退款。请在付款前确认确有解锁需要。
      </p>

      <h2>2. 唯一例外：已扣款但未交付</h2>
      <p>仅以下情况我们会全额退款：</p>
      <ul>
        <li>支付成功但服务端从未识别到付款，导致无水印解锁始终未交付。</li>
        <li>同一录制被误操作重复扣款。</li>
      </ul>
      <p>这些属于"交付失败 / 重复扣款"，而非对已交付商品的不满意。</p>

      <h2>3. 申请方式（仅限上述例外）</h2>
      <p>发邮件到 <a href="mailto:support@excalicast.cn">support@excalicast.cn</a>，并提供：</p>
      <ul>
        <li>付款时使用的电子邮箱；</li>
        <li>收据中的交易编号（形如 <code>txn_01...</code> 或 <code>ch_...</code>）；</li>
        <li>问题的简要说明。</li>
      </ul>

      <h2>4. 处理时效</h2>
      <ul>
        <li>我们一般在 <strong>2 个工作日内回复</strong>。</li>
        <li>批准后原路返回到你的支付方式。</li>
        <li>款项通常在 5–10 个工作日内到账，具体由发卡行决定。</li>
      </ul>

      <h2>5. 订阅</h2>
      <p>
        Pro / Max 订阅可随时取消以停止后续扣费，取消在当前计费周期结束时生效；已扣费的过往周期不退款。
      </p>

      <h2>6. 联系我们</h2>
      <p>
        如有任何问题，请联系 <a href="mailto:support@excalicast.cn">support@excalicast.cn</a>。
      </p>
    </>
  );
}
