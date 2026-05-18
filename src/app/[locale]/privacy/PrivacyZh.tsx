export function PrivacyZh(): JSX.Element {
  return (
    <>
      <p>
        Excalicast（&quot;我们&quot;、&quot;本服务&quot;）是一款在浏览器内运行的白板录制工具。本政策描述我们收集、使用、存储和分享你信息的方式。
      </p>

      <h2>1. 我们收集的信息</h2>
      <p>本服务的核心设计原则是<strong>录制内容不离开你的浏览器</strong>。具体而言：</p>
      <ul>
        <li>
          <strong>录制数据</strong>（白板操作事件、麦克风音频、摄像头视频等）：完全保存在你浏览器的本地存储（IndexedDB）中。
          我们不会上传、读取或备份这些数据。
        </li>
        <li>
          <strong>付费记录</strong>：当你为某条录制购买无水印解锁时，我们会在服务端保存以下信息——录制 ID、付款金额、币种、Paddle 交易 ID、付款时间。
          这些信息用于在你下次导出该录制时确认是否已购买。
        </li>
        <li>
          <strong>账号信息</strong>（如选择登录）：电子邮箱、加密后的登录凭证。我们不会保存明文密码。
        </li>
        <li>
          <strong>支付信息</strong>：所有支付信息（卡号、Apple Pay / Google Pay 凭证等）由
          {' '}<a href="https://www.paddle.com" target="_blank" rel="noopener noreferrer">Paddle</a>{' '}
          全程处理，<strong>Excalicast 服务端永远不接触</strong>你的支付信息。
        </li>
        <li>
          <strong>访问日志</strong>：托管服务商（Vercel）会自动记录基本的访问日志（IP、User-Agent、访问时间），用于安全审计和异常排查。
        </li>
      </ul>

      <h2>2. 我们如何使用信息</h2>
      <ul>
        <li>付费记录用于确认购买状态和提供无水印导出权限</li>
        <li>账号信息用于身份验证</li>
        <li>访问日志用于安全审计、异常排查、聚合统计</li>
      </ul>
      <p>我们<strong>不会出售、出租你的个人信息给任何第三方</strong>，也不会用于广告投放。</p>

      <h2>3. 第三方服务</h2>
      <p>Excalicast 使用以下第三方服务：</p>
      <ul>
        <li><strong>Paddle</strong>（支付处理）：提供 Checkout 弹层、信用卡处理、税务合规、收据发送。Paddle 的隐私政策见{' '}
          <a href="https://www.paddle.com/legal/privacy" target="_blank" rel="noopener noreferrer">paddle.com/legal/privacy</a>。
        </li>
        <li><strong>Vercel</strong>（托管）：网站部署和 CDN。Vercel 隐私政策见{' '}
          <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">vercel.com/legal/privacy-policy</a>。
        </li>
      </ul>

      <h2>4. Cookie</h2>
      <p>我们使用必要的 Cookie 用于：</p>
      <ul>
        <li>登录会话状态保持（仅当你选择登录时）</li>
        <li>用户偏好（如录制条位置等界面设置）</li>
      </ul>
      <p>我们<strong>不使用</strong>追踪类 Cookie 或第三方分析 Cookie。</p>

      <h2>5. 数据保留</h2>
      <ul>
        <li>录制数据：完全由你掌控。可在浏览器开发者工具或我们的&quot;录制库&quot;页面随时删除。</li>
        <li>付费记录：除非你申请删除账号，否则会持续保留以便提供购买后的导出权限。</li>
        <li>访问日志：通常保留 30 天。</li>
      </ul>

      <h2>6. 你的权利</h2>
      <p>你有权：</p>
      <ul>
        <li>访问我们持有的关于你的信息</li>
        <li>更正不准确的信息</li>
        <li>删除你的账号和相关付费记录（删除付费记录后，相关录制将无法继续无水印导出）</li>
        <li>请求导出你的数据</li>
      </ul>
      <p>
        如需行使上述权利，请发邮件到{' '}
        <a href="mailto:support@excalicast.cn">support@excalicast.cn</a>，我们会在 14 天内回复处理。
      </p>

      <h2>7. 儿童隐私</h2>
      <p>本服务不面向 13 岁以下儿童。如发现误收集了儿童信息，会立即删除。</p>

      <h2>8. 政策变更</h2>
      <p>本政策可能随时更新。重大变更会在本页面顶部以&quot;最后更新&quot;日期标明。建议定期查看。</p>

      <h2>9. 联系我们</h2>
      <p>
        关于本隐私政策的任何问题、申诉，请联系{' '}
        <a href="mailto:support@excalicast.cn">support@excalicast.cn</a>。
      </p>
    </>
  );
}
