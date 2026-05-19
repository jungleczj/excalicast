/**
 * 阿里千问 (Qwen-Audio / Paraformer) ASR via DashScope.
 *
 * 服务端专用 — 绝不可在客户端 import。
 *
 * 流程：
 *  1) submitTranscriptionTask(fileUrl): 提交异步任务 → 返回 task_id
 *  2) pollTranscriptionTask(taskId): 轮询直到 SUCCEEDED / FAILED
 *  3) fetchTranscriptionResult(transcription_url): 拉取最终 sentences[]
 *  4) sentencesToSrt(sentences): 拼接 SRT 文本
 *
 * ⚠️ 强制约束：本项目字幕统一用千问，禁止 OpenAI Whisper（见 CLAUDE.md）
 */

// DashScope endpoint. Defaults to the international region (used by intl-tier
// accounts). Override via DASHSCOPE_API_BASE if your key is on the mainland
// region (`https://dashscope.aliyuncs.com/api/v1`) or you need a different
// endpoint for testing.
const DASHSCOPE_BASE = process.env.DASHSCOPE_API_BASE || 'https://dashscope-intl.aliyuncs.com/api/v1';
const DEFAULT_MODEL = 'paraformer-v2';
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 100;

export interface QwenAsrSentence {
  begin_time: number; // ms
  end_time: number;   // ms
  text: string;
}

export interface SubmitOptions {
  fileUrl: string;
  model?: string;
  languageHints?: string[];
}

export interface SubmitResult {
  taskId: string;
}

function getApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error('DASHSCOPE_API_KEY is not set on the server');
  return key;
}

export async function submitTranscriptionTask(opts: SubmitOptions): Promise<SubmitResult> {
  const res = await fetch(`${DASHSCOPE_BASE}/services/audio/asr/transcription`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'X-DashScope-Async': 'enable',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      input: { file_urls: [opts.fileUrl] },
      parameters: {
        language_hints: opts.languageHints ?? ['zh', 'en'],
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DashScope submit failed ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    output?: { task_id?: string; task_status?: string };
    code?: string;
    message?: string;
  };
  const taskId = json.output?.task_id;
  if (!taskId) throw new Error(`DashScope submit no task_id: ${JSON.stringify(json).slice(0, 400)}`);
  return { taskId };
}

export interface PollResult {
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN';
  transcriptionUrl: string | null;
  errorMessage: string | null;
}

export async function pollTranscriptionTaskOnce(taskId: string): Promise<PollResult> {
  const res = await fetch(`${DASHSCOPE_BASE}/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DashScope poll failed ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    output?: {
      task_status?: string;
      results?: Array<{ transcription_url?: string; subtask_status?: string }>;
      message?: string;
    };
  };
  const status = (json.output?.task_status ?? 'UNKNOWN') as PollResult['status'];
  const url = json.output?.results?.[0]?.transcription_url ?? null;
  return {
    status,
    transcriptionUrl: url,
    errorMessage: json.output?.message ?? null,
  };
}

/**
 * Convenience wrapper: submit + poll loop until done.
 * Throws on FAILED / timeout. Returns final SRT string.
 */
export async function generateSrtFromUrl(fileUrl: string, opts?: { model?: string; languageHints?: string[] }): Promise<string> {
  const { taskId } = await submitTranscriptionTask({ fileUrl, ...opts });
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await pollTranscriptionTaskOnce(taskId);
    if (poll.status === 'SUCCEEDED' && poll.transcriptionUrl) {
      const sentences = await fetchTranscriptionResult(poll.transcriptionUrl);
      return sentencesToSrt(sentences);
    }
    if (poll.status === 'FAILED' || poll.status === 'CANCELED') {
      throw new Error(`DashScope task ${poll.status}: ${poll.errorMessage ?? 'unknown'}`);
    }
  }
  throw new Error(`DashScope ASR timeout after ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

export async function fetchTranscriptionResult(transcriptionUrl: string): Promise<QwenAsrSentence[]> {
  const res = await fetch(transcriptionUrl);
  if (!res.ok) throw new Error(`fetch transcription_url failed ${res.status}`);
  const json = (await res.json()) as {
    transcripts?: Array<{ sentences?: QwenAsrSentence[]; text?: string }>;
  };
  const sentences = json.transcripts?.[0]?.sentences ?? [];
  return sentences;
}

function msToSrtTime(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const hh = String(Math.floor(safe / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((safe % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((safe % 60_000) / 1000)).padStart(2, '0');
  const mmm = String(safe % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss},${mmm}`;
}

export function sentencesToSrt(sentences: QwenAsrSentence[]): string {
  const lines: string[] = [];
  sentences.forEach((s, idx) => {
    if (!s.text || !s.text.trim()) return;
    lines.push(String(idx + 1));
    lines.push(`${msToSrtTime(s.begin_time)} --> ${msToSrtTime(s.end_time)}`);
    lines.push(s.text.trim());
    lines.push('');
  });
  return lines.join('\n');
}

/**
 * Mock SRT for dev/E2E when no transcription service key is configured.
 * Returns a tiny valid SRT so UI flow can be verified end-to-end without external deps.
 */
export function mockSrt(): string {
  return sentencesToSrt([
    { begin_time: 0, end_time: 3000, text: '[示例字幕] 这是一段占位字幕，用于本地联调。' },
    { begin_time: 3000, end_time: 7000, text: '配置好语音服务密钥后将自动切换到真实转写。' },
    { begin_time: 7000, end_time: 12000, text: '支持中英文自动识别，输出 SRT 时间轴文件。' },
  ]);
}
