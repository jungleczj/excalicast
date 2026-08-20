import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  MediaJobDiagnosticError,
  executeMediaJobSubmission,
  mediaJobFailurePayload,
} from '@/lib/mediaJobDiagnostics';
import { parseMediaJobResponse } from '@/services/mediaJobClient';

test('repair migration keeps subtitle ownership on auth.users uuid', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260808122144_repair_media_job_schema.sql'),
    'utf8',
  );

  expect(sql).toMatch(/create table if not exists public\.subtitle_jobs\s*\([\s\S]*?user_id uuid not null references auth\.users\(id\) on delete cascade/i);
  expect(sql).toMatch(/create policy subtitle_jobs_self_read[\s\S]*?using \(\(select auth\.uid\(\)\) = user_id\)/i);
  expect(sql).not.toMatch(/auth\.uid\(\)\)::text\s*=\s*user_id/i);
});

test('production server keeps ws external so Edge TTS does not lose its mask implementation', () => {
  const config = fs.readFileSync(path.join(process.cwd(), 'next.config.mjs'), 'utf8');
  expect(config).toMatch(/['"]ws['"]\s*:\s*['"]commonjs ws['"]/);
});

test('latest repair migration adds dubbing voice fields, durable handout jobs, and a large recording bucket limit', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260818130000_background_handout_jobs.sql'),
    'utf8',
  );

  expect(sql).toMatch(/alter table public\.dubbing_jobs[\s\S]*?add column if not exists voice_name text/i);
  expect(sql).toMatch(/create table if not exists public\.handout_jobs/i);
  expect(sql).toMatch(/update storage\.buckets[\s\S]*?file_size_limit\s*=\s*1073741824/i);
  expect(sql).toMatch(/notify pgrst, 'reload schema'/i);
});

test('handout generation is submitted as a durable background job instead of running DeepSeek in the request', () => {
  const submit = fs.readFileSync(path.join(process.cwd(), 'src/app/api/handout/submit/route.ts'), 'utf8');
  const status = fs.readFileSync(path.join(process.cwd(), 'src/app/api/handout/status/route.ts'), 'utf8');
  const legacyGenerate = fs.readFileSync(path.join(process.cwd(), 'src/app/api/handout/generate/route.ts'), 'utf8');

  expect(submit).toContain('waitUntil');
  expect(submit).toContain('createHandoutJob');
  expect(status).toContain('getHandoutJob');
  expect(legacyGenerate).not.toContain('deepseekChat');
});

test('cloud recording uploads select resumable transfer for large camera objects', () => {
  const cloudSync = fs.readFileSync(path.join(process.cwd(), 'src/services/cloudSync.ts'), 'utf8');
  expect(cloudSync).toContain('uploadSupabaseStorageObject');
  expect(cloudSync).not.toMatch(/\.from\(BUCKET\)\s*\n\s*\.upload\(path, blob/);
});

test('missing dubbing_jobs table is reported as a retryable database migration failure', async () => {
  const failure = mediaJobFailurePayload({
    code: 'PGRST205',
    message: "Could not find the table 'public.dubbing_jobs' in the schema cache",
  }, 'database');

  expect(failure).toEqual({
    error: 'media_job_failed',
    code: 'PGRST205',
    stage: 'database',
    cause: 'database_table_missing',
  });
});

test('missing subtitle asset columns preserve the PostgREST schema-cache code', async () => {
  const failure = mediaJobFailurePayload({
    code: 'PGRST204',
    message: "Could not find the 'asset_path' column of 'subtitle_jobs' in the schema cache",
  }, 'database');

  expect(failure).toEqual({
    error: 'media_job_failed',
    code: 'PGRST204',
    stage: 'database',
    cause: 'database_schema_stale',
  });
});

test('database grants and Storage authorization failures remain distinguishable', async () => {
  expect(mediaJobFailurePayload({
    code: '42501',
    message: 'permission denied for table dubbing_jobs',
  }, 'database')).toEqual({
    error: 'media_job_failed',
    code: '42501',
    stage: 'database',
    cause: 'database_permission_denied',
  });

  expect(mediaJobFailurePayload({
    statusCode: '403',
    error: 'Unauthorized',
    message: 'new row violates row-level security policy',
  }, 'storage')).toEqual({
    error: 'media_job_failed',
    code: 'STORAGE_403',
    stage: 'storage',
    cause: 'storage_permission_denied',
  });
});

test('external provider details are reduced to a non-sensitive diagnostic', async () => {
  const failure = mediaJobFailurePayload(
    new Error('DashScope submit failed 502: upstream request id=req-secret provider payload'),
    'external_service',
  );

  expect(failure).toEqual({
    error: 'media_job_failed',
    code: 'EXTERNAL_SERVICE_502',
    stage: 'external_service',
    cause: 'external_service_unavailable',
  });
  expect(JSON.stringify(failure)).not.toContain('req-secret');
});

test('submission verifies Storage before creating a durable job and returns success', async () => {
  const calls: string[] = [];
  const result = await executeMediaJobSubmission({
    verifyStorage: async () => { calls.push('storage'); },
    createJob: async () => {
      calls.push('database');
      return { jobId: 'job-123', mock: false };
    },
  });

  expect(calls).toEqual(['storage', 'database']);
  expect(result).toEqual({ jobId: 'job-123', mock: false });
});

test('submission tags Storage and database failures with the failing stage', async () => {
  await expect(executeMediaJobSubmission({
    verifyStorage: async () => {
      throw { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' };
    },
    createJob: async () => ({ jobId: 'unreachable' }),
  })).rejects.toMatchObject({
    name: 'MediaJobDiagnosticError',
    diagnostic: { stage: 'storage', cause: 'storage_bucket_missing' },
  });

  await expect(executeMediaJobSubmission({
    verifyStorage: async () => undefined,
    createJob: async () => {
      throw { code: 'PGRST205', message: 'table is absent' };
    },
  })).rejects.toMatchObject({
    name: 'MediaJobDiagnosticError',
    diagnostic: { code: 'PGRST205', stage: 'database', cause: 'database_table_missing' },
  });
});

test('post-create failure preserves assets attached to a durable job', async () => {
  let cleanupCalls = 0;
  const operations = {
    verifyStorage: async () => undefined,
    createJob: async () => ({ jobId: 'durable-job' }),
    afterCreate: async () => {
      throw { code: 'PGRST204', message: 'status column schema cache failure' };
    },
    confirmJobCreated: async () => true,
    cleanupAssets: async () => { cleanupCalls += 1; },
  };

  await expect(executeMediaJobSubmission(operations)).rejects.toMatchObject({
    diagnostic: { stage: 'database', cause: 'database_schema_stale' },
  });
  expect(cleanupCalls).toBe(0);
});

test('failed insert cleans assets only after the job is confirmed absent', async () => {
  let confirmedAbsentCleanupCalls = 0;
  await expect(executeMediaJobSubmission({
    verifyStorage: async () => undefined,
    createJob: async () => { throw new Error('insert response lost'); },
    confirmJobCreated: async () => false,
    cleanupAssets: async () => { confirmedAbsentCleanupCalls += 1; },
  })).rejects.toMatchObject({ diagnostic: { stage: 'database' } });
  expect(confirmedAbsentCleanupCalls).toBe(1);

  let uncertainCleanupCalls = 0;
  await expect(executeMediaJobSubmission({
    verifyStorage: async () => undefined,
    createJob: async () => { throw new Error('insert response lost'); },
    confirmJobCreated: async () => { throw new Error('confirmation unavailable'); },
    cleanupAssets: async () => { uncertainCleanupCalls += 1; },
  })).rejects.toMatchObject({ diagnostic: { stage: 'database' } });
  expect(uncertainCleanupCalls).toBe(0);
});

test('client keeps structured submit diagnostics instead of collapsing to HTTP 500', async () => {
  const response = new Response(JSON.stringify({
    error: 'media_job_failed',
    code: 'PGRST205',
    stage: 'database',
    cause: 'database_table_missing',
  }), { status: 503, headers: { 'Content-Type': 'application/json' } });

  let caught: unknown;
  try {
    await parseMediaJobResponse<{ jobId: string }>(response);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(MediaJobDiagnosticError);
  expect(caught).toMatchObject({
    message: 'database_table_missing',
    diagnostic: {
      code: 'PGRST205',
      stage: 'database',
      cause: 'database_table_missing',
    },
  });
});
