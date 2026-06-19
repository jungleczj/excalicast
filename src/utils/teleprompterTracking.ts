/**
 * 提词器智能跟读：把「识别到的话」对齐到讲稿、求出读到第几个词。纯函数，可独立测试。
 *
 * 设计要点（修掉旧版"只取尾 3 词 + 前看 6 词"导致追不上的问题）：
 *  - 统一切成「匹配单元」：中文按**单字**、西文按**单词**（中文识别与讲稿的词边界经常对不齐，
 *    按字对齐才稳）。每个单元记住它属于讲稿的哪个词（wordIndex），用于高亮。
 *  - 对齐：取识别串尾部一段（最近说的 K 个单元），在讲稿「当前指针前方一个较大窗口」内找最佳落点，
 *    容忍少量跳读/误识；命中则把指针推进到该落点末尾。窗口足够大 → 成句说话也能追上；
 *    指针单调不回退 → 不闪烁。
 */

export interface ScriptToken { raw: string; isWord: boolean; n: string }
export interface ScriptUnit { key: string; wordIndex: number }

const CJK = /[㐀-鿿豈-﫿぀-ヿ]/; // 中日韩 + 假名
const normUnit = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** 把讲稿分词结果展开成匹配单元序列（中文逐字、西文逐词），并记录每个单元对应的讲稿词下标。 */
export function buildScriptUnits(tokens: ScriptToken[]): ScriptUnit[] {
  const units: ScriptUnit[] = [];
  tokens.forEach((t, wordIndex) => {
    if (!t.isWord || !t.n) return;
    if (CJK.test(t.raw)) {
      for (const ch of t.raw) { const key = normUnit(ch); if (key) units.push({ key, wordIndex }); }
    } else {
      units.push({ key: t.n, wordIndex });
    }
  });
  return units;
}

/** 把识别到的文本展开成同样的匹配单元 key 序列。 */
export function recognizedUnits(tokens: ScriptToken[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (!t.isWord || !t.n) continue;
    if (CJK.test(t.raw)) { for (const ch of t.raw) { const key = normUnit(ch); if (key) out.push(key); } }
    else out.push(t.n);
  }
  return out;
}

const eq = (a: string, b: string): boolean => a === b || (a.length > 2 && b.length > 2 && (a.startsWith(b) || b.startsWith(a)));

/**
 * 推进单元指针。返回新的单元指针（单调不回退；无可信匹配则原样返回）。
 * @param scriptUnits 讲稿单元序列
 * @param said 识别到的单元序列（整段，最近的在尾部）
 * @param ptr 当前单元指针
 */
export function advanceUnitPointer(scriptUnits: ScriptUnit[], said: string[], ptr: number): number {
  if (said.length === 0 || scriptUnits.length === 0) return ptr;
  const K = Math.min(6, said.length);
  const tail = said.slice(-K);              // 最近说出的若干单元（连续识别 interim 会重复整句，故只看尾部）
  const last = tail[tail.length - 1];
  const FWD = 80;                           // 锚点前看窗口放大：跳读一段也能追上
  const BACK = 4;                           // 容许小幅回看以纠正重读（结果仍单调不回退）
  const lo = Math.max(0, ptr - BACK);
  const hi = Math.min(scriptUnits.length - 1, ptr + FWD);

  // 锚定「最后说出的单元」在讲稿中、指针附近的落点 L；再用其前面的尾词向后确认，抗同字误命中。
  let bestScore = 0;
  let bestEnd = ptr;
  for (let L = lo; L <= hi; L++) {
    if (!eq(scriptUnits[L].key, last)) continue;
    let score = 1;
    let j = L - 1;
    for (let ti = tail.length - 2; ti >= 0 && j >= 0 && (L - j) <= K + 4; ti--) {
      let matched = false;
      for (let skip = 0; skip <= 2 && j - skip >= 0; skip++) {
        if (eq(scriptUnits[j - skip].key, tail[ti])) { j = j - skip - 1; score++; matched = true; break; }
      }
      if (!matched) j--; // 容忍一个误识/漏字单元
    }
    if (score > bestScore || (score === bestScore && L + 1 > bestEnd)) { bestScore = score; bestEnd = L + 1; }
  }

  const need = Math.max(2, Math.ceil(K * 0.4));
  if (bestScore >= need) return Math.max(ptr, bestEnd);
  return ptr;
}

/** 单元指针 → 高亮的讲稿词下标（指针指向"下一个未读单元"，当前词取其前一个单元所属词）。 */
export function unitPointerToWordIndex(scriptUnits: ScriptUnit[], ptr: number): number {
  const i = Math.min(ptr, scriptUnits.length) - 1;
  if (i < 0) return -1;
  return scriptUnits[i].wordIndex;
}
