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
// Intl region uses Qwen3 ASR file-trans model + `input.file_url` (string).
// Mainland region uses Paraformer + `input.file_urls` (array).
const IS_INTL = DASHSCOPE_BASE.includes('dashscope-intl');
const DEFAULT_MODEL = process.env.DASHSCOPE_ASR_MODEL
  || (IS_INTL ? 'qwen3-asr-flash-filetrans' : 'paraformer-v2');
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
  // Intl Qwen3-ASR uses `input.file_url` (singular string); mainland paraformer
  // uses `input.file_urls` (array). Build the right shape based on region.
  const input = IS_INTL
    ? { file_url: opts.fileUrl }
    : { file_urls: [opts.fileUrl] };
  // Qwen3-ASR doesn't accept `language_hints` the same way; only pass it for paraformer.
  const parameters: Record<string, unknown> = IS_INTL
    ? { enable_words: true }
    : { language_hints: opts.languageHints ?? ['zh', 'en'] };

  const res = await fetch(`${DASHSCOPE_BASE}/services/audio/asr/transcription`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'X-DashScope-Async': 'enable',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      input,
      parameters,
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
  /**
   * 业务化的轮询状态：
   *  - NO_SPEECH 表示 DashScope 返回 SUCCESS_WITH_NO_VALID_FRAGMENT
   *    （音频里没有可识别语音）。这是 DashScope 的"成功完成但无结果"语义，
   *    我们把它从 UNKNOWN 单独拎出来，下游可以按业务错误处理。
   */
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'NO_SPEECH' | 'UNKNOWN';
  transcriptionUrl: string | null;
  /** 上游原始 message（可能含中文）。NO_SPEECH 时收敛为 null，让上层用业务码翻译。 */
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
      // Paraformer-v2 (mainland): output.results[0].transcription_url
      results?: Array<{ transcription_url?: string; subtask_status?: string }>;
      // Qwen3-ASR-Flash (intl): output.result.transcription_url
      result?: { transcription_url?: string };
      message?: string;
    };
  };
  const taskStatus = json.output?.task_status ?? 'UNKNOWN';
  const subtaskStatus = json.output?.results?.[0]?.subtask_status;
  const url =
    json.output?.result?.transcription_url ??
    json.output?.results?.[0]?.transcription_url ??
    null;
  const message = json.output?.message ?? null;

  // 任一信号都判 NO_SPEECH：
  //  (1) task_status 直接是 SUCCESS_WITH_NO_VALID_FRAGMENT（实测出现）
  //  (2) 子任务 subtask_status 是同一码
  //  (3) message / task_status 字符串包含 NO_VALID_FRAGMENT（兜底，覆盖 message-only 情况）
  //  (4) task_status 是 SUCCEEDED 但完全没有 transcription_url（兜底，模型差异）
  const matchesNoFragment = (s: string | undefined | null): boolean =>
    !!s && s.includes('NO_VALID_FRAGMENT');
  const isNoSpeech =
    taskStatus === 'SUCCESS_WITH_NO_VALID_FRAGMENT' ||
    subtaskStatus === 'SUCCESS_WITH_NO_VALID_FRAGMENT' ||
    matchesNoFragment(taskStatus) ||
    matchesNoFragment(message) ||
    (taskStatus === 'SUCCEEDED' && !url);

  if (isNoSpeech) {
    return { status: 'NO_SPEECH', transcriptionUrl: null, errorMessage: null };
  }

  const status = taskStatus as PollResult['status'];
  return {
    status,
    transcriptionUrl: url,
    errorMessage: message,
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
    if (poll.status === 'NO_SPEECH') {
      throw new Error('no_speech_detected');
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
