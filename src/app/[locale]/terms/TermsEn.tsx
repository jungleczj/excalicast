export function TermsEn({ oneTimePrice }: { oneTimePrice: string }): JSX.Element {
  return (
    <>
      <p>
        Welcome to Excalicast (&quot;the service&quot;). By accessing or using this service, you agree to these Terms of Service.
        If you do not agree, please do not use the service.
      </p>

      <h2>1. Service Description</h2>
      <p>Excalicast is a browser-based whiteboard recorder that provides:</p>
      <ul>
        <li>Synchronized capture of whiteboard activity + mic audio + optional camera video.</li>
        <li>Multi-ratio MP4 export (watermarked is free; {oneTimePrice} per recording for permanent watermark-free unlock).</li>
        <li>Recordings stored in your local browser; the server only retains payment records.</li>
      </ul>

      <h2>2. License</h2>
      <p>
        We grant you a <strong>non-exclusive, non-transferable, revocable</strong> limited license
        to use the service in accordance with these Terms. This license is for personal or lawful commercial use only.
      </p>

      <h2>3. Pricing &amp; Payments</h2>
      <ul>
        <li>Price: watermark-free unlock for a single recording is {oneTimePrice}, one-time payment, permanent unlock for that recording&apos;s watermark-free export.</li>
        <li>Processing: all payments are processed by Paddle.com Inc. Paddle acts as the registered merchant of record on behalf of Excalicast and handles collection and tax remittance.</li>
        <li>Currency: USD. The final amount may vary slightly due to taxes and exchange rates; the actual charge is shown on the checkout page.</li>
        <li>Receipts: Paddle emails the receipt to the address you provide upon successful payment.</li>
        <li>Price changes: we reserve the right to change future prices at any time. Purchases already made are not affected.</li>
      </ul>

      <h2>4. Refunds</h2>
      <p>
        See the <a href="/refund">refund policy page</a> for details. Summary: the one-time watermark-free export is a
        digital product delivered instantly and is non-refundable; the only exception is a charge where the unlock was
        never delivered. Contact <a href="mailto:support@excalicast.cn">support@excalicast.cn</a>.
      </p>

      <h2>5. User Conduct</h2>
      <p>When using the service, you <strong>must not</strong>:</p>
      <ul>
        <li>Record content that violates laws or infringes third-party intellectual property or personality rights.</li>
        <li>Record and distribute violent, sexual, gambling, drug-related, or terrorism-related content.</li>
        <li>Attempt unauthorized access to, cracking of, or reverse engineering of the service.</li>
        <li>Use automated tools to call the service&apos;s APIs at scale.</li>
        <li>Commit fraud via the payment / refund flow.</li>
      </ul>
      <p>Violating any of the above gives us the right to immediately terminate your access, and we reserve the right to pursue legal remedies.</p>

      <h2>6. Intellectual Property</h2>
      <ul>
        <li>The service&apos;s code, UI, trademarks, and documentation are owned by Excalicast.</li>
        <li>Recording content you create (graphics, audio, video) is <strong>owned by you</strong>. We claim no usage or derivative rights.</li>
      </ul>

      <h2>7. Disclaimer</h2>
      <p>
        The service is provided &quot;as is&quot;, without any express or implied warranties — including but not limited to merchantability, fitness for a particular purpose, or non-infringement.
        We make best efforts to keep the service available, but do not guarantee <strong>uninterrupted or error-free</strong> operation.
      </p>
      <p>Specifically, we are not liable for losses caused by:</p>
      <ul>
        <li>Browser crashes or local-storage loss damaging recording content.</li>
        <li>Third-party service outages (Paddle, Vercel, etc.).</li>
        <li>Payment or download failures caused by your network environment.</li>
      </ul>

      <h2>8. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, Excalicast is not liable for any indirect, incidental, special, or punitive damages.
        In any case, our aggregate liability shall not exceed the <strong>amount you actually paid us in the preceding 12 months</strong>.
      </p>

      <h2>9. Termination</h2>
      <p>
        We may terminate your access immediately if you breach these Terms. You may also stop using the service and delete your account at any time.
        After termination, <strong>amounts already paid are non-refundable except as provided in the refund policy</strong>, but content you have already downloaded remains yours.
      </p>

      <h2>10. Changes to Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be noted at the top of this page via the &quot;Last updated&quot; date.
        Continued use of the service constitutes acceptance of the updated Terms.
      </p>

      <h2>11. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the People&apos;s Republic of China. Any dispute will first be resolved through good-faith negotiation;
        if negotiation fails, it shall be submitted to a court with jurisdiction over the service provider&apos;s location.
      </p>

      <h2>12. Contact</h2>
      <p>
        For any questions about these Terms, please contact <a href="mailto:support@excalicast.cn">support@excalicast.cn</a>.
      </p>
    </>
  );
}
