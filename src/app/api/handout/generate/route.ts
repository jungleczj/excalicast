import { POST as submitHandout } from '../submit/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Backward-compatible alias. Generation is now enqueued and completed by the
// durable handout background worker; no model call runs in this request.
export async function POST(req: Request) {
  return submitHandout(req);
}
