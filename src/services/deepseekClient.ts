import 'server-only';

/**
 * Deepseek 服务端 client。OpenAI-compatible /v1/chat/completions。
 * 模型默认走 `deepseek-chat`。response_format = json_object 强制返回纯 JSON。
 *
 * env: DEEPSEEK_API_KEY（必填）。
 */

const DEFAULT_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';

export interface DeepseekChatOptions {
  prompt: string;
  systemPrompt?: string;
  /** 默认 deepseek-chat */
  model?: string;
  /** 默认 60_000ms */
  timeoutMs?: number;
  /** 默认 true (response_format = json_object) */
  jsonMode?: boolean;
}

export interface DeepseekChatResult {
  text: string;
  modelUsed: string;
}

export async function deepseekChat(opts: DeepseekChatOptions): Promise<DeepseekChatResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');
  const base = (process.env.DEEPSEEK_API_BASE ?? DEFAULT_BASE).replace(/\/+$/, '');
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const jsonMode = opts.jsonMode ?? true;

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push({ role: 'user', content: opts.prompt });

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.4,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Deepseek timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Deepseek network: ${err instanceof Error ? err.message : 'unknown'}`);
  }
  clearTimeout(timer);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Deepseek ${res.status}: ${text.slice(0, 300)}`);
  }
  let json: { choices?: Array<{ message?: { content?: string } }> };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Deepseek non-JSON response: ${text.slice(0, 200)}`);
  }
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Deepseek: empty content');
  }
  return { text: content, modelUsed: model };
}
