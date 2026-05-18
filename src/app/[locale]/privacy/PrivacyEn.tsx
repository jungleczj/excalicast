export function PrivacyEn(): JSX.Element {
  return (
    <>
      <p>
        Excalicast (&quot;we,&quot; &quot;our service&quot;) is a browser-based whiteboard recorder.
        This policy describes how we collect, use, store, and share your information.
      </p>

      <h2>1. Information We Collect</h2>
      <p>The core design principle of this service is that <strong>recording content never leaves your browser</strong>. Specifically:</p>
      <ul>
        <li>
          <strong>Recording data</strong> (whiteboard operation events, microphone audio, camera video, etc.) is stored entirely
          in your browser&apos;s local storage (IndexedDB). We do not upload, read, or back up this data.
        </li>
        <li>
          <strong>Payment records</strong>: when you purchase a watermark-free unlock for a specific recording, we store
          the following on our server — recording ID, amount paid, currency, Paddle transaction ID, and payment timestamp.
          This is used to confirm purchase status the next time you export that recording.
        </li>
        <li>
          <strong>Account information</strong> (if you choose to sign in): email address and hashed authentication credentials.
          We never store plaintext passwords.
        </li>
        <li>
          <strong>Payment information</strong>: all payment data (card numbers, Apple Pay / Google Pay tokens, etc.) is processed
          end-to-end by <a href="https://www.paddle.com" target="_blank" rel="noopener noreferrer">Paddle</a>.
          <strong>Excalicast servers never see</strong> your payment information.
        </li>
        <li>
          <strong>Access logs</strong>: our hosting provider (Vercel) automatically records basic access logs (IP, User-Agent, timestamp)
          for security auditing and incident triage.
        </li>
      </ul>

      <h2>2. How We Use Information</h2>
      <ul>
        <li>Payment records are used to verify purchase status and grant watermark-free export access.</li>
        <li>Account information is used for authentication.</li>
        <li>Access logs are used for security auditing, troubleshooting, and aggregated statistics.</li>
      </ul>
      <p>We <strong>do not sell or rent your personal information to any third party</strong>, nor use it for advertising.</p>

      <h2>3. Third-Party Services</h2>
      <p>Excalicast uses the following third-party services:</p>
      <ul>
        <li><strong>Paddle</strong> (payment processing): provides the Checkout overlay, card processing, tax compliance, and receipt delivery.
          Paddle&apos;s privacy policy: <a href="https://www.paddle.com/legal/privacy" target="_blank" rel="noopener noreferrer">paddle.com/legal/privacy</a>.
        </li>
        <li><strong>Vercel</strong> (hosting): site deployment and CDN.
          Vercel&apos;s privacy policy: <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">vercel.com/legal/privacy-policy</a>.
        </li>
      </ul>

      <h2>4. Cookies</h2>
      <p>We use essential cookies for:</p>
      <ul>
        <li>Login session persistence (only when you choose to sign in).</li>
        <li>User preferences (e.g. recorder bar position and other UI settings).</li>
      </ul>
      <p>We <strong>do not</strong> use tracking cookies or third-party analytics cookies.</p>

      <h2>5. Data Retention</h2>
      <ul>
        <li>Recording data: entirely under your control. You can delete it anytime via your browser&apos;s developer tools or our &quot;Library&quot; page.</li>
        <li>Payment records: retained for as long as your account exists, so we can honor watermark-free export access.</li>
        <li>Access logs: retained for approximately 30 days.</li>
      </ul>

      <h2>6. Your Rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>Access the information we hold about you.</li>
        <li>Correct inaccurate information.</li>
        <li>Delete your account and associated payment records (note: deleting payment records means the corresponding recordings can no longer be exported without watermarks).</li>
        <li>Request an export of your data.</li>
      </ul>
      <p>
        To exercise these rights, email <a href="mailto:support@excalicast.cn">support@excalicast.cn</a>.
        We will respond within 14 days.
      </p>

      <h2>7. Children&apos;s Privacy</h2>
      <p>This service is not directed at children under 13. If we discover we have inadvertently collected information from a child, we will delete it immediately.</p>

      <h2>8. Policy Changes</h2>
      <p>This policy may be updated from time to time. Material changes will be noted at the top of this page via the &quot;Last updated&quot; date. Please review periodically.</p>

      <h2>9. Contact</h2>
      <p>
        For questions or complaints regarding this privacy policy, please contact <a href="mailto:support@excalicast.cn">support@excalicast.cn</a>.
      </p>
    </>
  );
}
