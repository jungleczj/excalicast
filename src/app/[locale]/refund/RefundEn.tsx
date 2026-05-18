export function RefundEn(): JSX.Element {
  return (
    <>
      <p>
        We want every user to have a satisfying experience. If you&apos;re not happy with your &quot;single-recording watermark-free unlock&quot; purchase,
        you can request a full refund under the conditions below.
      </p>

      <h2>1. Refund Window</h2>
      <p>
        Full refunds may be requested <strong>within 14 calendar days of payment</strong>.
        After 14 days we generally do not process refunds; special cases (e.g. system outages preventing usage) can be raised via email.
      </p>

      <h2>2. Eligible Cases</h2>
      <p>We will always approve refunds in these cases:</p>
      <ul>
        <li>Payment succeeded but the server never recognized it (preventing watermark-free unlock).</li>
        <li>Technical failure during export prevented you from obtaining the target MP4.</li>
        <li>You&apos;re not happy with the service (no detailed reason needed).</li>
        <li>Accidental duplicate purchase.</li>
      </ul>

      <h2>3. Ineligible Cases</h2>
      <p>Refunds will be denied in these cases:</p>
      <ul>
        <li>Payment is more than 14 days old.</li>
        <li>The same user has had 2 or more refunds in the past 90 days (to prevent abuse).</li>
        <li>Recording content clearly violates the <a href="/terms">Terms of Service</a> and your access was terminated.</li>
      </ul>

      <h2>4. How to Request</h2>
      <p>Email <a href="mailto:support@excalicast.cn">support@excalicast.cn</a> and include:</p>
      <ul>
        <li>The email used at checkout.</li>
        <li>The transaction ID from your Paddle receipt (looks like <code>txn_01...</code>).</li>
        <li>The reason for the refund (one sentence is fine — helps us improve).</li>
      </ul>
      <p>No forms, no phone confirmation required.</p>

      <h2>5. Processing Time</h2>
      <ul>
        <li>We typically <strong>reply within 2 business days</strong>.</li>
        <li>Once approved, Paddle initiates the refund back to your original payment method.</li>
        <li>
          The time for funds to arrive depends on your card issuer, typically:
          <ul>
            <li>Credit cards: 5–10 business days.</li>
            <li>Apple Pay / Google Pay: 5–10 business days.</li>
            <li>Local payment methods (e.g. bank transfers in some countries): may take longer.</li>
          </ul>
        </li>
      </ul>

      <h2>6. Service Status After Refund</h2>
      <p>
        Once a refund is approved, the &quot;watermark-free unlock&quot; for the corresponding recording <strong>is revoked immediately</strong>.
        MP4 files you have already downloaded locally are unaffected and remain usable.
      </p>

      <h2>7. Contact</h2>
      <p>
        For any refund questions, please contact <a href="mailto:support@excalicast.cn">support@excalicast.cn</a>.
      </p>
    </>
  );
}
