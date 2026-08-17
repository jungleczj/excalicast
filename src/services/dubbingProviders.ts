import 'server-only';

import { splitDubbingSrt } from '@/lib/dubbingAudio';
import { deepseekChat } from '@/services/deepseekClient';

export interface DubbingTranslationResult {
  translatedSrt: string;
  provider: string;
}

function cleanTranslatedSrt(value: string): string {
  const cleaned = value.trim().replace(/^```(?:srt)?\s*/i, '').replace(/\s*```$/, '').trim();
  splitDubbingSrt(cleaned);
  return cleaned;
}

export async function generateDubbingTranslation(sourceSrt: string): Promise<DubbingTranslationResult> {
  if (!sourceSrt.trim()) throw new Error('dubbing_subtitles_required');
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('deepseek_not_configured');
  const model = process.env.DEEPSEEK_TRANSLATION_MODEL ?? 'deepseek-v4-flash';
  const result = await deepseekChat({
    jsonMode: false,
    timeoutMs: 60_000,
    model,
    systemPrompt: [
      'Translate only the spoken text in this SRT into concise, conversational English suitable for natural voice dubbing.',
      'Preserve every cue number and timestamp exactly.',
      'Keep each cue short enough to speak within its original time range without rushing.',
      'Use punctuation to preserve natural pauses, emphasis, and sentence rhythm.',
      'Return valid SRT only, without markdown or commentary.',
    ].join(' '),
    prompt: sourceSrt,
  });
  return {
    translatedSrt: cleanTranslatedSrt(result.text),
    provider: model,
  };
}
