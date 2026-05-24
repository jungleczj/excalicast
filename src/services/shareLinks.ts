/**
 * 服务端：share_links 生成 / 签名 URL。
 *
 * - 不上传新文件 —— 复用 recordings_cloud 的 storage prefix。
 * - 签名 URL TTL = 1h（足够单次播放，避免长时间外泄）。
 * - short_code 用 nanoid（避免 uuid 太长）。
 *
 * Storage 对象：metadata.json + snapshots.json.gz + audio.webm? + camera.webm? + cameraPositions.json.gz?
 */

import 'server-only';
import { createClient as createSupabaseAdmin, type SupabaseClient } from '@supabase/supabase-js';
import { getCloudRecording, insertShareLink, type ShareLinkRow } from '@/lib/db';

const SHARE_TTL_DAYS = 30;
const SIGN_URL_TTL_SECONDS = 60 * 60; // 1h
const SHARE_BUCKET = 'recordings';

// 8 字符 URL-safe code，去掉 0/O/1/l 这种易混淆字符。
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';

export function generateShortCode(length = 8): string {
  let out = '';
  const buf = new Uint8Array(length);
  // server: crypto.getRandomValues 在 Node 19+ 是 global
  crypto.getRandomValues(buf);
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  }
  return out;
}

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_admin_not_configured');
  return createSupabaseAdmin(url, key, { auth: { persistSession: false } });
}

export interface CreatedShare {
  shortCode: string;
  url: string;
  expiresAt: number;
}

export async function createShareLinkForRecording(params: {
  userId: string;
  recordingId: string;
  appUrl: string;
}): Promise<CreatedShare> {
  const cloud = await getCloudRecording(params.userId, params.recordingId);
  if (!cloud) {
    throw new Error('cloud_recording_required: 请先把录制备份到云端再生成分享链接');
  }
  const expiresAt = Date.now() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000;
  // 简单 retry：理论上 8 字符冲突极小，但用 unique 索引保底再 try 一次
  let row: ShareLinkRow | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const shortCode = generateShortCode(8);
    try {
      row = await insertShareLink({
        shortCode,
        recordingId: params.recordingId,
        userId: params.userId,
        expiresAt,
      });
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('duplicate key')) throw err;
      // collision —— retry
    }
  }
  if (!row) throw new Error('share_code_collision');
  const base = params.appUrl.replace(/\/+$/, '');
  return {
    shortCode: row.shortCode,
    url: `${base}/s/${row.shortCode}`,
    expiresAt: row.expiresAt,
  };
}

export interface ShareObjects {
  metadata: string;       // signed URL
  snapshots: string;
  audio: string | null;
  camera: string | null;
  cameraPositions: string | null;
}

async function signOne(
  client: SupabaseClient,
  path: string,
  ttlSeconds: number,
): Promise<string | null> {
  const { data, error } = await client.storage.from(SHARE_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * 给一个 recording 的 5 个云端对象签发 URL。可选对象不存在时返回 null（不要抛错）。
 */
export async function signRecordingObjects(
  storagePrefix: string,
  hasAudio: boolean,
  hasCamera: boolean,
): Promise<ShareObjects> {
  const client = adminClient();
  const prefix = storagePrefix.replace(/\/$/, '');
  const [metadata, snapshots, audio, camera, cameraPositions] = await Promise.all([
    signOne(client, `${prefix}/metadata.json`, SIGN_URL_TTL_SECONDS),
    signOne(client, `${prefix}/snapshots.json.gz`, SIGN_URL_TTL_SECONDS),
    hasAudio ? signOne(client, `${prefix}/audio.webm`, SIGN_URL_TTL_SECONDS) : Promise.resolve(null),
    hasCamera ? signOne(client, `${prefix}/camera.webm`, SIGN_URL_TTL_SECONDS) : Promise.resolve(null),
    signOne(client, `${prefix}/cameraPositions.json.gz`, SIGN_URL_TTL_SECONDS),
  ]);
  if (!metadata) throw new Error('sign_metadata_failed');
  if (!snapshots) throw new Error('sign_snapshots_failed');
  return { metadata, snapshots, audio, camera, cameraPositions };
}
