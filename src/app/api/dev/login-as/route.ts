import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dev-only：免邮件登录。
 *
 * 给定 email：
 *   1) 用 service-role admin 确保 auth.users 里有这个邮箱（缺失则创建并标记 confirmed）
 *   2) admin.generateLink 拿到一次性 email_otp
 *   3) 通过 SSR client 调 verifyOtp → SSR adapter 自动把 session cookies
 *      写到响应 Set-Cookie 头里
 *
 * 调用方拿到响应后，浏览器/HTTP 客户端的 cookie jar 就有了正确的
 * `sb-<project-ref>-auth-token` cookie，后续请求可以直接走 Pro 鉴权路径。
 *
 * 仅在 DEV_MODE=true 时启用。生产环境必须 false，否则任意 email 都能登。
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (process.env.DEV_MODE !== 'true') {
    return NextResponse.json({ error: 'dev_mode_disabled' }, { status: 403 });
  }

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email.includes('@')) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Ensure user exists (idempotent)
  let userId: string | null = null;
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error && !/already.*registered|exists/i.test(error.message)) {
      return NextResponse.json({ error: `create_user: ${error.message}` }, { status: 500 });
    }
    userId = data.user?.id ?? null;
  } catch (err) {
    return NextResponse.json(
      { error: `create_user_exception: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // 2) Generate a one-shot email OTP for this user
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !linkData?.properties?.email_otp) {
    return NextResponse.json(
      { error: `generate_link: ${linkErr?.message ?? 'no_otp'}` },
      { status: 500 },
    );
  }

  // 3) Exchange OTP via SSR client → writes session cookies to the response
  const supabase = await createSupabaseServerClient();
  const { data: verifyData, error: verifyErr } = await supabase.auth.verifyOtp({
    type: 'email',
    token: linkData.properties.email_otp,
    email,
  });
  if (verifyErr || !verifyData.session) {
    return NextResponse.json(
      { error: `verify_otp: ${verifyErr?.message ?? 'no_session'}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    userId: userId ?? verifyData.user?.id ?? null,
    email,
  });
}
