# Paddle Payment Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Creem payment placeholder with Paddle Overlay Checkout for $3 one-time per-recording watermark unlock, sandbox-first.

**Architecture:** Frontend uses `@paddle/paddle-js` to open Paddle Overlay in-page; on `checkout.completed` the client polls `/api/is-paid` until the Paddle webhook (authoritative) writes `paid_recordings` via HMAC-verified `/api/paddle-webhook`. Anonymous purchase preserved (Paddle collects email).

**Tech Stack:** Next.js 14 App Router, `@paddle/paddle-js` (already installed), `better-sqlite3`, Node `crypto.createHmac`, `crypto.timingSafeEqual`.

**Spec:** `docs/superpowers/specs/2026-05-06-paddle-payment-design.md`

**Note on testing:** The project has no test framework set up. Verification per task uses `node -e` scripts for pure functions, `curl` for endpoints, and manual browser steps for UI. Adding vitest is out of scope.

**Sandbox values used in this plan** (taken from spec):
- Price ID: `pri_01kqxh5px07a1ezc42xpta118s`
- API key: `<PADDLE_SANDBOX_API_KEY>`
- Client token: `test_b111bb96f343e11e6274baa6ff8`
- Webhook secret: `<PADDLE_SANDBOX_WEBHOOK_SECRET>`

---

## File-Level Changes (overview)

**Create:**
- `src/lib/paddle.ts`
- `src/app/api/paddle-webhook/route.ts`
- `src/components/providers/PaddleProvider.tsx`
- `src/services/paddleClient.ts`
- `docs/paddle-local-dev.md`

**Modify:**
- `src/lib/db.ts` — schema migration + rename `creem_session_id` → `paddle_transaction_id`, `markRecordingPaid` param rename
- `src/types/recording.ts` — `PaidRecordingRow.creem_session_id` → `paddle_transaction_id`
- `src/app/api/dev/simulate-payment/route.ts` — update param name, comment
- `src/components/PaywallModal.tsx` — replace redirect with Overlay open + polling, copy update, dev link
- `src/components/ExportPanel.tsx` — remove `?paid=1` query handling
- `src/app/layout.tsx` — wrap with `<PaddleProvider>`
- `.env.local` — add Paddle vars (manual; documented in plan)

**Delete:**
- `src/lib/creem.ts`
- `src/app/api/creem-webhook/route.ts`
- `src/app/api/checkout/route.ts`

---

## Phase A — DB and types rename (no behavior change yet)

### Task 1: Idempotent DB migration to rename `creem_session_id` → `paddle_transaction_id`

**Files:**
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Update `getDb()` to run idempotent rename**

Replace the `db.exec(` ... `paid_recordings` ... `)` block in `src/lib/db.ts` so the table is created with the new column name AND, if an old database has the legacy column, it's renamed. Keep all other tables (`users`, `auth_sessions`) unchanged.

Replace lines 20–46 (the `db.exec(...)` call) with:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS paid_recordings (
      recording_id TEXT PRIMARY KEY,
      paid_at INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      paddle_transaction_id TEXT NOT NULL,
      raw_payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
  `);

  // Idempotent migration: rename legacy column if present
  const cols = db.prepare("PRAGMA table_info(paid_recordings)").all() as { name: string }[];
  const hasOld = cols.some((c) => c.name === 'creem_session_id');
  const hasNew = cols.some((c) => c.name === 'paddle_transaction_id');
  if (hasOld && !hasNew) {
    db.exec('ALTER TABLE paid_recordings RENAME COLUMN creem_session_id TO paddle_transaction_id');
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_paid_recordings_paddle ON paid_recordings(paddle_transaction_id);');
```

- [ ] **Step 2: Update `markRecordingPaid` to accept `paddleTransactionId`**

In the same file, replace the existing `markRecordingPaid` function (lines 96–117) with:

```ts
export function markRecordingPaid(params: {
  recordingId: string;
  amountCents: number;
  currency: string;
  paddleTransactionId: string;
  rawPayload: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO paid_recordings (recording_id, paid_at, amount_cents, currency, paddle_transaction_id, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(recording_id) DO NOTHING`,
    )
    .run(
      params.recordingId,
      Date.now(),
      params.amountCents,
      params.currency,
      params.paddleTransactionId,
      params.rawPayload,
    );
}
```

- [ ] **Step 3: Verify migration on a legacy DB**

Run:

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast
# Make a synthetic legacy db
mkdir -p /tmp/paddle-mig-test
node -e "
const Database = require('better-sqlite3');
const db = new Database('/tmp/paddle-mig-test/legacy.db');
db.exec(\`
CREATE TABLE paid_recordings (
  recording_id TEXT PRIMARY KEY,
  paid_at INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  creem_session_id TEXT NOT NULL,
  raw_payload TEXT NOT NULL
);
INSERT INTO paid_recordings VALUES ('rec_abc', 0, 300, 'usd', 'sess_old', '{}');\`);
console.log(db.prepare('PRAGMA table_info(paid_recordings)').all().map(c => c.name).join(','));
db.close();
"
```

Expected output: `recording_id,paid_at,amount_cents,currency,creem_session_id,raw_payload`

Then simulate the migration block manually:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('/tmp/paddle-mig-test/legacy.db');
const cols = db.prepare('PRAGMA table_info(paid_recordings)').all();
const hasOld = cols.some((c) => c.name === 'creem_session_id');
const hasNew = cols.some((c) => c.name === 'paddle_transaction_id');
if (hasOld && !hasNew) {
  db.exec('ALTER TABLE paid_recordings RENAME COLUMN creem_session_id TO paddle_transaction_id');
}
console.log(db.prepare('PRAGMA table_info(paid_recordings)').all().map(c => c.name).join(','));
console.log(JSON.stringify(db.prepare('SELECT * FROM paid_recordings').all()));
db.close();
"
```

Expected output line 1: `recording_id,paid_at,amount_cents,currency,paddle_transaction_id,raw_payload`
Expected output line 2: `[{"recording_id":"rec_abc","paid_at":0,"amount_cents":300,"currency":"usd","paddle_transaction_id":"sess_old","raw_payload":"{}"}]`

Cleanup: `rm -rf /tmp/paddle-mig-test`

- [ ] **Step 4: Verify the project's local DB still works**

Delete the existing local db (it has no real data per spec confirmation):

```bash
rm -f /Users/chenzhijiang/.claude/projects/excalicast/data/excalicast.db /Users/chenzhijiang/.claude/projects/excalicast/data/excalicast.db-wal /Users/chenzhijiang/.claude/projects/excalicast/data/excalicast.db-shm
```

Note: do not commit the db file. It is regenerated on next dev run.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts
git commit -m "$(cat <<'EOF'
db: rename creem_session_id to paddle_transaction_id

Idempotent ALTER TABLE migration so existing dbs upgrade automatically.
markRecordingPaid params updated; callers updated in next commits.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Update PaidRecordingRow type

**Files:**
- Modify: `src/types/recording.ts:1-8`

- [ ] **Step 1: Rename type field**

Replace lines 1–8 of `src/types/recording.ts` with:

```ts
export interface PaidRecordingRow {
  recording_id: string;
  paid_at: number;
  amount_cents: number;
  currency: string;
  paddle_transaction_id: string;
  raw_payload: string;
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && npm run typecheck
```

Expected: errors in `src/lib/creem.ts` and other Creem-related files reference `creem_session_id` / `creemSessionId`. These will be fixed in Task 3 (callers) and removed entirely in Task 11 (delete creem). For now, expect failures pointing at:
- `src/app/api/creem-webhook/route.ts:40` — uses `creemSessionId`
- `src/app/api/dev/simulate-payment/route.ts:30` — uses `creemSessionId`

Continue to Task 3 to fix these.

- [ ] **Step 3: Commit**

```bash
git add src/types/recording.ts
git commit -m "$(cat <<'EOF'
types: rename PaidRecordingRow.creem_session_id

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update simulate-payment caller (rename param)

**Files:**
- Modify: `src/app/api/dev/simulate-payment/route.ts:26-32`

- [ ] **Step 1: Update markRecordingPaid call**

Replace lines 26–32 with:

```ts
  markRecordingPaid({
    recordingId,
    amountCents,
    currency,
    paddleTransactionId: `dev_simulated_${Date.now()}`,
    rawPayload: JSON.stringify({ simulated: true, recordingId }),
  });
```

Also update the doc comment on line 7:

```ts
 * 开发专用：直接把 recordingId 写入 paid_recordings 表，模拟 Paddle 支付完成。
```

- [ ] **Step 2: Verify typecheck no longer flags this file**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && npm run typecheck 2>&1 | grep "simulate-payment" || echo "OK: simulate-payment clean"
```

Expected: `OK: simulate-payment clean` (errors will remain in `creem-webhook/route.ts` and `lib/creem.ts` — those will be deleted in Task 11).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/dev/simulate-payment/route.ts
git commit -m "$(cat <<'EOF'
dev: update simulate-payment to use paddleTransactionId

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Paddle library and webhook endpoint

### Task 4: Create `src/lib/paddle.ts` (signature verification + payload parsing)

**Files:**
- Create: `src/lib/paddle.ts`

- [ ] **Step 1: Write the file**

Create `src/lib/paddle.ts` with:

```ts
import crypto from 'node:crypto';

export interface PaddleTransactionCompleted {
  transactionId: string;
  recordingId: string;
  amountCents: number;
  currency: string;
}

/**
 * Verify Paddle webhook signature.
 * Header format: `Paddle-Signature: ts=<unix>;h1=<hex hmac>`
 * HMAC input: `${ts}:${rawBody}` (NOT the bare body — Paddle-specific)
 * Algorithm: HMAC-SHA256 with PADDLE_WEBHOOK_SECRET.
 *
 * Spec ref: https://developer.paddle.com/webhooks/signature-verification
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return process.env.DEV_MODE === 'true';
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(';').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;

  // Reject signatures older than 5 minutes (replay protection)
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSec > 300) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(h1, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Parse a `transaction.completed` Paddle webhook payload into our internal shape.
 * Returns null if event_type is not `transaction.completed` or required fields are missing.
 *
 * Paddle payload (abridged):
 * {
 *   "event_type": "transaction.completed",
 *   "data": {
 *     "id": "txn_01...",
 *     "currency_code": "USD",
 *     "custom_data": { "recordingId": "rec_..." },
 *     "details": { "totals": { "total": "300" } }   // string, in minor units
 *   }
 * }
 */
export function parseTransactionCompleted(payload: unknown): PaddleTransactionCompleted | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.event_type !== 'transaction.completed') return null;

  const data = p.data as Record<string, unknown> | undefined;
  if (!data) return null;

  const transactionId = typeof data.id === 'string' ? data.id : '';
  if (!transactionId) return null;

  const customData = data.custom_data as Record<string, unknown> | undefined;
  const recordingId = customData && typeof customData.recordingId === 'string'
    ? customData.recordingId
    : '';
  if (!recordingId) return null;

  const currency = typeof data.currency_code === 'string' ? data.currency_code.toLowerCase() : 'usd';

  const details = data.details as Record<string, unknown> | undefined;
  const totals = details?.totals as Record<string, unknown> | undefined;
  const totalRaw = totals?.total;
  const amountCents = typeof totalRaw === 'string' ? Number(totalRaw) : Number(totalRaw ?? 0);

  return {
    transactionId,
    recordingId,
    amountCents: Number.isFinite(amountCents) ? amountCents : 0,
    currency,
  };
}
```

- [ ] **Step 2: Verify with node -e (signature verification round-trip)**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && PADDLE_WEBHOOK_SECRET=test_secret node --input-type=module -e "
import crypto from 'node:crypto';
const { verifyWebhookSignature } = await import('./src/lib/paddle.ts');
" 2>&1 | head -5
```

Note: you can't `import` a `.ts` file directly with node. Instead, verify the algorithm matches Paddle's spec by hand-rolling a positive and negative test:

```bash
PADDLE_WEBHOOK_SECRET=test_secret node -e "
const crypto = require('node:crypto');

// Re-implement the verifier inline (copy of the algorithm) and compare
function verify(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = sigHeader.split(';').reduce((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const ts = parts.ts, h1 = parts.h1;
  if (!ts || !h1) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(ts + ':' + rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(h1, 'hex')); }
  catch { return false; }
}

const secret = 'test_secret';
const body = JSON.stringify({event_type:'transaction.completed'});
const ts = Math.floor(Date.now()/1000);
const sig = crypto.createHmac('sha256', secret).update(ts + ':' + body).digest('hex');
const validHeader = 'ts=' + ts + ';h1=' + sig;

console.log('valid:', verify(body, validHeader, secret));        // expect true
console.log('tampered:', verify(body + 'X', validHeader, secret)); // expect false
console.log('expired:', verify(body, 'ts=' + (ts - 600) + ';h1=' + sig, secret)); // expect false
console.log('missing:', verify(body, null, secret));              // expect false
"
```

Expected output:
```
valid: true
tampered: false
expired: false
missing: false
```

- [ ] **Step 3: Verify `parseTransactionCompleted` separately**

Same approach — manual parse via inline verifier:

```bash
node -e "
const sample = {
  event_type: 'transaction.completed',
  data: {
    id: 'txn_01abc',
    currency_code: 'USD',
    custom_data: { recordingId: 'rec_abc' },
    details: { totals: { total: '300' } }
  }
};
// reimplement parser inline
function parse(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.event_type !== 'transaction.completed') return null;
  const d = p.data; if (!d) return null;
  const id = typeof d.id === 'string' ? d.id : '';
  if (!id) return null;
  const r = d.custom_data && typeof d.custom_data.recordingId === 'string' ? d.custom_data.recordingId : '';
  if (!r) return null;
  const cur = typeof d.currency_code === 'string' ? d.currency_code.toLowerCase() : 'usd';
  const t = d.details && d.details.totals && d.details.totals.total;
  const a = typeof t === 'string' ? Number(t) : Number(t ?? 0);
  return { transactionId: id, recordingId: r, amountCents: Number.isFinite(a) ? a : 0, currency: cur };
}
console.log(JSON.stringify(parse(sample)));
console.log(parse({event_type: 'transaction.created', data: {}}));
console.log(parse(null));
console.log(parse({event_type: 'transaction.completed', data: { id: 'txn_x' }})); // missing recordingId → null
"
```

Expected output:
```
{"transactionId":"txn_01abc","recordingId":"rec_abc","amountCents":300,"currency":"usd"}
null
null
null
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/paddle.ts
git commit -m "$(cat <<'EOF'
lib: add Paddle webhook signature verification and payload parser

HMAC-SHA256 over ts:rawBody per Paddle spec. Includes 5-minute
replay-protection window. transaction.completed payloads parsed
into PaddleTransactionCompleted with recordingId from custom_data.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Create `/api/paddle-webhook/route.ts`

**Files:**
- Create: `src/app/api/paddle-webhook/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/paddle-webhook/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { verifyWebhookSignature, parseTransactionCompleted } from '@/lib/paddle';
import { markRecordingPaid } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('paddle-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const event = parseTransactionCompleted(payload);
  if (!event) {
    // Not a transaction.completed event we care about (or missing fields).
    // Acknowledge so Paddle does not retry.
    return NextResponse.json({ ok: true, ignored: true });
  }

  markRecordingPaid({
    recordingId: event.recordingId,
    amountCents: event.amountCents,
    currency: event.currency,
    paddleTransactionId: event.transactionId,
    rawPayload: rawBody,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && npm run typecheck 2>&1 | grep -E "paddle-webhook|paddle.ts" || echo "OK: new paddle files clean"
```

Expected: `OK: new paddle files clean`. Other Creem-related errors still fine; cleaned up in Task 11.

- [ ] **Step 3: Boot dev server and curl-test 401 path**

In one terminal:

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && DEV_MODE=false npm run dev
```

Wait for `Ready` line. In another terminal:

```bash
curl -s -X POST http://localhost:3001/api/paddle-webhook \
  -H 'Content-Type: application/json' \
  -d '{"event_type":"transaction.completed"}' \
  -w '\nHTTP %{http_code}\n'
```

Expected: `{"error":"invalid_signature"}` and `HTTP 401` (no signature header sent, secret unset → DEV_MODE=false → reject).

Stop the dev server (Ctrl-C).

- [ ] **Step 4: Verify happy path with valid signature**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && PADDLE_WEBHOOK_SECRET=test_secret npm run dev &
DEV_PID=$!
sleep 4

BODY='{"event_type":"transaction.completed","data":{"id":"txn_test_123","currency_code":"USD","custom_data":{"recordingId":"rec_plan_test"},"details":{"totals":{"total":"300"}}}}'
TS=$(date +%s)
SIG=$(node -e "const c=require('crypto');console.log(c.createHmac('sha256','test_secret').update('$TS:'+process.argv[1]).digest('hex'))" "$BODY")

curl -s -X POST http://localhost:3001/api/paddle-webhook \
  -H 'Content-Type: application/json' \
  -H "Paddle-Signature: ts=$TS;h1=$SIG" \
  -d "$BODY" \
  -w '\nHTTP %{http_code}\n'

# Verify db row inserted
sqlite3 /Users/chenzhijiang/.claude/projects/excalicast/data/excalicast.db \
  "SELECT recording_id, amount_cents, currency, paddle_transaction_id FROM paid_recordings WHERE recording_id='rec_plan_test';"

kill $DEV_PID 2>/dev/null
```

Expected output:
- Curl: `{"ok":true}` and `HTTP 200`
- sqlite3: `rec_plan_test|300|usd|txn_test_123`

If sqlite3 isn't installed, replace last command with:

```bash
node -e "const D=require('better-sqlite3');const d=new D('/Users/chenzhijiang/.claude/projects/excalicast/data/excalicast.db');console.log(d.prepare('SELECT * FROM paid_recordings WHERE recording_id=?').get('rec_plan_test'));"
```

- [ ] **Step 5: Cleanup test data and commit**

```bash
node -e "const D=require('better-sqlite3');const d=new D('/Users/chenzhijiang/.claude/projects/excalicast/data/excalicast.db');d.prepare('DELETE FROM paid_recordings WHERE recording_id=?').run('rec_plan_test');"

git add src/app/api/paddle-webhook/route.ts
git commit -m "$(cat <<'EOF'
api: add /api/paddle-webhook for transaction.completed

Verifies Paddle-Signature HMAC, parses transaction.completed,
writes paid_recordings via markRecordingPaid. Idempotent at the
db layer (ON CONFLICT DO NOTHING).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Frontend Paddle infrastructure

### Task 6: Create `PaddleProvider`

**Files:**
- Create: `src/components/providers/PaddleProvider.tsx`

- [ ] **Step 1: Write the provider**

```tsx
'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { initializePaddle, type Paddle, type CheckoutEventNames } from '@paddle/paddle-js';

interface PaddleContextValue {
  paddle: Paddle | null;
  // Most recent event name; consumers subscribe via subscribe()
  subscribe: (cb: (event: { name: CheckoutEventNames; data?: unknown }) => void) => () => void;
}

const PaddleContext = createContext<PaddleContextValue>({
  paddle: null,
  subscribe: () => () => {},
});

export function PaddleProvider({ children }: { children: ReactNode }): JSX.Element {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [listeners] = useState<Set<(e: { name: CheckoutEventNames; data?: unknown }) => void>>(
    () => new Set(),
  );

  useEffect(() => {
    const env = process.env.NEXT_PUBLIC_PADDLE_ENV;
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!env || !token) {
      // Allow app to run without Paddle for dev-mock workflows
      console.warn('[PaddleProvider] missing NEXT_PUBLIC_PADDLE_ENV or NEXT_PUBLIC_PADDLE_CLIENT_TOKEN; Paddle disabled');
      return;
    }
    initializePaddle({
      environment: env as 'sandbox' | 'production',
      token,
      eventCallback: (event) => {
        listeners.forEach((cb) => cb({ name: event.name, data: event.data }));
      },
    })
      .then((p) => setPaddle(p ?? null))
      .catch((err) => {
        console.error('[PaddleProvider] initializePaddle failed', err);
      });
  }, [listeners]);

  const subscribe = (cb: (e: { name: CheckoutEventNames; data?: unknown }) => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };

  return (
    <PaddleContext.Provider value={{ paddle, subscribe }}>
      {children}
    </PaddleContext.Provider>
  );
}

export function usePaddle(): PaddleContextValue {
  return useContext(PaddleContext);
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && npm run typecheck 2>&1 | grep "PaddleProvider" || echo "OK: PaddleProvider clean"
```

Expected: `OK: PaddleProvider clean`.

- [ ] **Step 3: Commit**

```bash
git add src/components/providers/PaddleProvider.tsx
git commit -m "$(cat <<'EOF'
components: add PaddleProvider wrapping initializePaddle

Exposes paddle instance + a subscribe() helper so multiple
components can listen to checkout.* events fanned out from
Paddle.js eventCallback.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wrap root layout with `<PaddleProvider>`

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Update layout**

Replace the entire content of `src/app/layout.tsx` with:

```tsx
import './globals.css';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { PaddleProvider } from '@/components/providers/PaddleProvider';

export const metadata = {
  title: 'Excalicast',
  description: '白板录制 · 录一次得到 N 个比例的视频',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="zh-CN">
      <body className="h-screen antialiased">
        <SessionProvider>
          <PaddleProvider>{children}</PaddleProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify dev server boots without runtime error**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && npm run dev &
DEV_PID=$!
sleep 4
curl -s http://localhost:3001/ -o /dev/null -w 'HTTP %{http_code}\n'
kill $DEV_PID 2>/dev/null
```

Expected: `HTTP 200` (or 307/308 redirect to /library — also acceptable).

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "$(cat <<'EOF'
layout: wrap app with PaddleProvider

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Create `paddleClient.ts` openCheckout helper

**Files:**
- Create: `src/services/paddleClient.ts`

- [ ] **Step 1: Write the helper**

```ts
'use client';

import type { Paddle } from '@paddle/paddle-js';

export interface OpenCheckoutOptions {
  paddle: Paddle;
  recordingId: string;
}

/**
 * Open Paddle Overlay Checkout for a single-recording one-time purchase.
 * The caller is responsible for subscribing to checkout.completed (via
 * usePaddle().subscribe) before calling this — that's how it learns when
 * to start polling /api/is-paid.
 */
export function openCheckout({ paddle, recordingId }: OpenCheckoutOptions): void {
  const priceId = process.env.NEXT_PUBLIC_PADDLE_PRICE_ID;
  if (!priceId) {
    throw new Error('NEXT_PUBLIC_PADDLE_PRICE_ID is not set');
  }
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customData: { recordingId },
    settings: {
      displayMode: 'overlay',
      theme: 'light',
      locale: 'zh',
    },
  });
}

export function closeCheckout(paddle: Paddle): void {
  // Paddle.js API exposes Checkout.close() for programmatic dismissal
  try {
    paddle.Checkout.close();
  } catch {
    // safe to ignore — already closed
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && npm run typecheck 2>&1 | grep "paddleClient" || echo "OK: paddleClient clean"
```

Expected: `OK: paddleClient clean`.

- [ ] **Step 3: Commit**

```bash
git add src/services/paddleClient.ts
git commit -m "$(cat <<'EOF'
services: add paddleClient.openCheckout / closeCheckout

Thin wrapper that supplies priceId + customData {recordingId}
to Paddle.Checkout.open. Listening for checkout.completed
happens at the consumer (PaywallModal) via usePaddle().subscribe.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Switch PaywallModal to Paddle

### Task 9: Rewrite PaywallModal to use Overlay + polling + dev link

**Files:**
- Modify: `src/components/PaywallModal.tsx` (complete rewrite of body)

- [ ] **Step 1: Replace the file**

Replace entire content of `src/components/PaywallModal.tsx` with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { I } from '@/components/icons';
import { isPaid, simulatePayment } from '@/services/paymentClient';
import { openCheckout, closeCheckout } from '@/services/paddleClient';
import { usePaddle } from '@/components/providers/PaddleProvider';

interface Props {
  open: boolean;
  recordingId: string;
  onClose: () => void;
  onPaid?: () => void;
}

const PRICE_USD = '$3';
const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 10;

export function PaywallModal({ open, recordingId, onClose, onPaid }: Props): JSX.Element | null {
  const { paddle, subscribe } = usePaddle();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const pollingRef = useRef(false);

  // Subscribe to Paddle events while modal is open
  useEffect(() => {
    if (!open) return;
    const unsubscribe = subscribe((event) => {
      if (event.name === 'checkout.completed') {
        setStatusMsg('支付完成，正在确认…');
        if (paddle) closeCheckout(paddle);
        void pollUntilPaid();
      } else if (event.name === 'checkout.closed') {
        if (!pollingRef.current) {
          // user dismissed without completing
          setBusy(false);
        }
      }
    });
    return unsubscribe;
  }, [open, paddle, subscribe]); // eslint-disable-line react-hooks/exhaustive-deps

  const pollUntilPaid = async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          if (await isPaid(recordingId)) {
            setStatusMsg('已解锁！');
            onPaid?.();
            onClose();
            return;
          }
        } catch {
          // transient — keep polling
        }
      }
      setStatusMsg('支付确认中，请稍后刷新页面。');
    } finally {
      pollingRef.current = false;
      setBusy(false);
    }
  };

  if (!open) return null;

  const handleUnlock = () => {
    setError(null);
    setStatusMsg(null);
    if (!paddle) {
      setError('Paddle 尚未初始化，请稍后重试或检查网络。');
      return;
    }
    setBusy(true);
    try {
      openCheckout({ paddle, recordingId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setBusy(false);
    }
  };

  const handleDevSimulate = async () => {
    setError(null);
    setStatusMsg('正在模拟支付…');
    setBusy(true);
    try {
      await simulatePayment(recordingId);
      onPaid?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'simulate_failed');
    } finally {
      setBusy(false);
    }
  };

  const showDevLink = process.env.NEXT_PUBLIC_DEV_MODE === 'true';

  return (
    <div
      className="fade-in fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-[460px] max-w-[92vw] rounded-2xl bg-bg-primary p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
          aria-label="关闭"
        >
          ✕
        </button>

        <div
          className="mb-4 grid h-14 w-14 place-items-center rounded-2xl text-white"
          style={{ background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))' }}
        >
          <I.Lock size={28} />
        </div>
        <h2 className="text-[20px] font-bold leading-tight text-text-primary">解锁无水印导出</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          这条录制将<strong className="text-text-primary">永久解锁</strong>，可以任意比例 / 框选模式反复导出无水印 MP4。
          单次购买，<strong className="text-text-primary">无需注册账号</strong>。
        </p>

        <div className="mt-5 flex items-end gap-2 rounded-xl border border-border-default bg-bg-secondary p-4">
          <span className="font-mono text-[36px] font-bold leading-none text-text-primary">{PRICE_USD}</span>
          <span className="pb-1 text-[12px] text-text-tertiary">一次性 · 仅限本录制</span>
        </div>

        <ul className="mt-4 space-y-2 text-[13px] text-text-secondary">
          {[
            '导出永久去除水印',
            '可反复导出 16:9 / 9:16 / 1:1 / 4:5 多个比例',
            '录制数据全程留在你浏览器，服务端只存付费状态',
            'Paddle 安全支付（信用卡 / Apple Pay / Google Pay）',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <I.Check size={14} sw={2.5} className="mt-0.5 flex-shrink-0 text-success-600" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {(statusMsg || error) && (
          <div className="mt-4 rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-[12px]">
            {statusMsg && <div className="text-text-primary">{statusMsg}</div>}
            {error && <div className="mt-1 text-recording-strong">错误：{error}</div>}
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-md border border-border-strong bg-bg-primary px-4 py-2.5 text-[13px] font-medium text-text-primary hover:bg-bg-tertiary disabled:opacity-40"
          >
            暂不需要
          </button>
          <button
            onClick={handleUnlock}
            disabled={busy || !paddle}
            className="flex flex-[2] items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold text-white shadow-md disabled:opacity-40"
            style={{ background: 'var(--accent-600)', boxShadow: '0 4px 12px rgba(217,119,6,0.3)' }}
          >
            <I.Lock size={14} />
            {busy ? '正在打开 Paddle…' : `立即解锁 · ${PRICE_USD}`}
          </button>
        </div>

        {showDevLink && (
          <button
            onClick={handleDevSimulate}
            disabled={busy}
            className="mt-3 w-full text-center text-[10px] text-text-tertiary underline hover:text-text-secondary disabled:opacity-40"
          >
            [dev] 跳过 Paddle，直接标记已付款
          </button>
        )}

        <p className="mt-3 text-center text-[10px] text-text-tertiary">
          支付完成后自动切换到无水印模式
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && npm run typecheck 2>&1 | grep "PaywallModal" || echo "OK: PaywallModal clean"
```

Expected: `OK: PaywallModal clean`.

- [ ] **Step 3: Commit**

```bash
git add src/components/PaywallModal.tsx
git commit -m "$(cat <<'EOF'
components: rewrite PaywallModal to use Paddle Overlay + polling

Removes redirect-to-Creem flow. checkout.completed event now
triggers /api/is-paid polling (10x1s) until webhook persists.
Adds dev-only 'skip Paddle' link gated on NEXT_PUBLIC_DEV_MODE.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Remove `?paid=1` query handling from ExportPanel

**Files:**
- Modify: `src/components/ExportPanel.tsx:42-51`

- [ ] **Step 1: Update ExportPanel**

In `src/components/ExportPanel.tsx`, delete the `useEffect` block that parses the `paid=1` query param (lines 42–51):

```tsx
  // Creem 支付返回后自动刷新付费状态
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('paid') === '1') {
      setStatusMsg('支付完成，已自动切换到无水印模式。');
      window.history.replaceState({}, '', window.location.pathname);
      void refreshPaid();
    }
  }, [refreshPaid]);
```

Replace with: nothing. The PaywallModal now drives `onPaid` notifications via the polling logic.

Also wire up `onPaid` from the modal so that ExportPanel refreshes paid state after dev-simulate or polling. Find the `<PaywallModal>` JSX block at the bottom of the component and update it to:

```tsx
      <PaywallModal
        open={paywallOpen}
        recordingId={recordingId}
        onClose={() => setPaywallOpen(false)}
        onPaid={() => {
          setStatusMsg('已解锁，无水印模式已开启。');
          void refreshPaid();
        }}
      />
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && npm run typecheck 2>&1 | grep "ExportPanel" || echo "OK: ExportPanel clean"
```

Expected: `OK: ExportPanel clean`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ExportPanel.tsx
git commit -m "$(cat <<'EOF'
components: drop ?paid=1 query handling, wire onPaid callback

PaywallModal now signals paid state through onPaid; the legacy
URL param flow is gone since Paddle Overlay does not redirect.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — Cleanup

### Task 11: Delete Creem files

**Files:**
- Delete: `src/lib/creem.ts`
- Delete: `src/app/api/creem-webhook/route.ts`
- Delete: `src/app/api/checkout/route.ts`

- [ ] **Step 1: Delete files**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast
rm src/lib/creem.ts
rm src/app/api/creem-webhook/route.ts
rm src/app/api/checkout/route.ts
# Also remove the now-empty parent dirs if empty
rmdir src/app/api/creem-webhook 2>/dev/null || true
rmdir src/app/api/checkout 2>/dev/null || true
```

- [ ] **Step 2: Remove unused types from recording.ts**

In `src/types/recording.ts`, delete the `CheckoutRequest` and `CheckoutResponse` interfaces (they were only used by the deleted `/api/checkout` route and `paymentClient.startCheckout`).

```ts
// DELETE these from src/types/recording.ts:
export interface CheckoutRequest {
  recordingId: string;
  returnPath?: string;
}

export interface CheckoutResponse {
  checkoutUrl: string;
  sessionId: string;
}
```

- [ ] **Step 3: Remove `startCheckout` from paymentClient.ts**

In `src/services/paymentClient.ts`, delete the `startCheckout` function and its `import { CheckoutRequest, CheckoutResponse }`. Keep `isPaid` and `simulatePayment`. Final file content:

```ts
'use client';

import type { IsPaidRequest, IsPaidResponse } from '@/types/recording';

export async function isPaid(recordingId: string): Promise<boolean> {
  const res = await fetch('/api/is-paid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId } satisfies IsPaidRequest),
  });
  if (!res.ok) throw new Error(`is-paid ${res.status}`);
  const data = (await res.json()) as IsPaidResponse;
  return data.paid;
}

export async function simulatePayment(recordingId: string): Promise<void> {
  const res = await fetch('/api/dev/simulate-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId }),
  });
  if (!res.ok) throw new Error(`simulate-payment ${res.status}`);
}
```

- [ ] **Step 4: Run typecheck and verify clean**

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && npm run typecheck
```

Expected: exit code 0, no errors.

If errors remain about leftover Creem references, grep:

```bash
grep -rn "creem\|Creem" /Users/chenzhijiang/.claude/projects/excalicast/src 2>/dev/null
```

Should return no matches. Fix any remaining references before committing.

- [ ] **Step 5: Commit**

```bash
git add -u src/lib src/app/api src/types src/services
git commit -m "$(cat <<'EOF'
chore: delete Creem placeholder integration

Removes lib/creem.ts, /api/checkout, /api/creem-webhook,
CheckoutRequest/Response types, and paymentClient.startCheckout.
Paddle is the only payment path now.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — Documentation and end-to-end verification

### Task 12: Add `.env.local` template comment + local-dev runbook

**Files:**
- Create: `docs/paddle-local-dev.md`

- [ ] **Step 1: Write the runbook**

Create `docs/paddle-local-dev.md`:

```markdown
# Paddle 本地调试

两层方案：层 1 快速 mock 用于日常开发，层 2 sandbox + cloudflared 用于部署前 e2e 验证。

## 层 1 — Dev Mock（不需要任何 Paddle 配置）

`.env.local`：

\`\`\`
DEV_MODE=true
NEXT_PUBLIC_DEV_MODE=true
\`\`\`

启动：

\`\`\`
npm run dev
\`\`\`

录一条 → 点 "解锁并下载 $3" → 在 Paywall 弹层底部点 "[dev] 跳过 Paddle，直接标记已付款" → 切到无水印。

## 层 2 — Sandbox + Cloudflared（完整 Paddle 链路）

### 一次性准备（已完成）

- Sandbox 账号：https://sandbox-vendors.paddle.com
- 一次性 Price：\`pri_01kqxh5px07a1ezc42xpta118s\`（USD $3）
- API key：\`<PADDLE_SANDBOX_API_KEY>\`
- Client token：\`test_b111bb96f343e11e6274baa6ff8\`
- Webhook secret：\`<PADDLE_SANDBOX_WEBHOOK_SECRET>\`

### 每次开发启动

Terminal 1：

\`\`\`
npm run dev
\`\`\`

Terminal 2：

\`\`\`
cloudflared tunnel --url http://localhost:3001
\`\`\`

复制输出的 \`https://xxx.trycloudflare.com\` URL，去 Paddle Sandbox Dashboard → Developer Tools → Notifications → 编辑 destination，把 URL 改为 \`https://xxx.trycloudflare.com/api/paddle-webhook\`（事件勾选 \`transaction.completed\`）。secret 不变。

### `.env.local`（sandbox）

\`\`\`
NEXT_PUBLIC_PADDLE_ENV=sandbox
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_b111bb96f343e11e6274baa6ff8
NEXT_PUBLIC_PADDLE_PRICE_ID=pri_01kqxh5px07a1ezc42xpta118s
PADDLE_WEBHOOK_SECRET=<PADDLE_SANDBOX_WEBHOOK_SECRET>
PADDLE_API_KEY=<PADDLE_SANDBOX_API_KEY>
DEV_MODE=true
NEXT_PUBLIC_DEV_MODE=true
\`\`\`

### 测试卡

- 卡号：\`4000 0566 5566 5556\`
- 过期：任意未来日期
- CVC：任意
- 邮编：\`10001\`

### 验证

录一条 → "立即解锁 · $3" → Paddle Overlay 弹出 → 用测试卡支付 → 1-3 秒内 ExportPanel 自动切换到无水印模式。

### 排查

- Overlay 不弹出：浏览器控制台看 \`[PaddleProvider] initializePaddle failed\`，多半是 token 错或环境变量没暴露给客户端（必须 \`NEXT_PUBLIC_\` 前缀）
- 支付完成但 UI 不切换：服务端日志看是否收到 webhook；签名校验失败（401）说明 secret 错或 cloudflared URL 没更新到 Paddle destination
- 多次启动 cloudflared URL 会变，每次都要更新 Paddle destination

## 部署 production

把 \`.env.local\` 的 sandbox 值换成 production 账号下重新创建的（Paddle production 是独立账号），写到 Vercel Project → Environment Variables。**生产不要设 \`DEV_MODE\` / \`NEXT_PUBLIC_DEV_MODE\`**，否则 dev mock 链接会显示给真实用户。

Production webhook URL：\`https://excalicast.vercel.app/api/paddle-webhook\`
\`\`\`

> Note: the doc above intentionally does NOT use markdown code fences with bash inside backticked variables — it uses escaped backticks (`\`\`\``) only at the outer fence boundary because we are writing this from inside a markdown code block. When you save the file, ensure the OUTPUT file uses regular (unescaped) ` ``` ` fences.

- [ ] **Step 2: Verify the file renders correctly**

```bash
cat /Users/chenzhijiang/.claude/projects/excalicast/docs/paddle-local-dev.md | head -20
```

Expected: shows the markdown header `# Paddle 本地调试` and the section headings without escaped backticks.

If escaped backticks appear, edit them out (replace `\`\`\`` with ` ``` `).

- [ ] **Step 3: Commit**

```bash
git add docs/paddle-local-dev.md
git commit -m "$(cat <<'EOF'
docs: add Paddle local dev runbook (mock + sandbox+tunnel)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Manual sandbox e2e verification

**Files:** None (verification only)

- [ ] **Step 1: Set up `.env.local` per docs/paddle-local-dev.md layer 2 section**

Make sure `.env.local` contains the seven variables listed in the runbook.

- [ ] **Step 2: Start dev server and tunnel**

Terminal 1:

```bash
cd /Users/chenzhijiang/.claude/projects/excalicast && npm run dev
```

Terminal 2:

```bash
cloudflared tunnel --url http://localhost:3001
```

Copy the `https://xxx.trycloudflare.com` URL.

- [ ] **Step 3: Update Paddle Sandbox destination**

Log into https://sandbox-vendors.paddle.com → Developer Tools → Notifications → destination → set URL to `https://xxx.trycloudflare.com/api/paddle-webhook`. Confirm event `transaction.completed` is enabled. Save.

- [ ] **Step 4: Smoke-test the full flow**

In a browser at `http://localhost:3001`:

1. Record a short clip (microphone optional)
2. Stop recording → land on `/export/<id>`
3. Switch to "无水印导出" radio
4. Click "解锁并下载 · $3"
5. Paddle Overlay opens
6. Fill email + test card `4000 0566 5566 5556`, exp `12/30`, CVC `100`, ZIP `10001`
7. Submit

Expected:
- Overlay closes within ~1-2s
- Status text shows "支付完成，正在确认…"
- Within ~2-3s, modal closes; ExportPanel header shows "已解锁，无水印模式已开启。"
- Click "渲染并下载（无水印）" → MP4 downloads without watermark

Verify db row:

```bash
node -e "const D=require('better-sqlite3');const d=new D('/Users/chenzhijiang/.claude/projects/excalicast/data/excalicast.db');console.log(d.prepare('SELECT recording_id, paddle_transaction_id, amount_cents FROM paid_recordings ORDER BY paid_at DESC LIMIT 1').get());"
```

Expected: a row whose `paddle_transaction_id` starts with `txn_01...` (real Paddle transaction id).

- [ ] **Step 5: Smoke-test dev mock path independently**

Stop cloudflared. Record another clip, click "解锁" → click the gray "[dev] 跳过 Paddle" link → modal closes → no-watermark mode active. (This proves the mock path didn't regress.)

- [ ] **Step 6: Commit (no code changes)**

If any small bug fixes were needed during e2e (e.g. typo in env var name or copy), commit them now. Otherwise no commit; this task is verification only.

---

## Self-Review checkpoints

- [x] DB rename covered (Task 1)
- [x] Type rename covered (Task 2)
- [x] All `creemSessionId` callers updated (Tasks 1, 3) before deletion (Task 11)
- [x] Paddle signature lib + webhook covered (Tasks 4, 5)
- [x] Paddle.js client init covered (Tasks 6, 7)
- [x] PaywallModal rewrite covered (Task 9)
- [x] ExportPanel cleanup covered (Task 10)
- [x] Creem deletion covered (Task 11)
- [x] Local dev docs covered (Task 12)
- [x] e2e verification covered (Task 13)
- [x] Replay protection note in `lib/paddle.ts` (Task 4)
- [x] Idempotent migration (Task 1) — covers existing dev DBs
- [x] Dev link gated on `NEXT_PUBLIC_DEV_MODE` (Task 9) — does not leak to production
- [x] Spec section 11 (rollback) is just text in spec, no plan task needed

## What this plan does NOT do (matches spec section 2 "non-goals")

- No Vercel SQLite → Postgres migration (data still lost on Vercel cold start)
- No refund webhook handler (`transaction.refunded`)
- No automated test suite (no test infra exists; verification is per-step manual)
- No subscription / multi-currency / tax features
