import type { TextConverter } from './epub'

export type SourceScript = 'traditional' | 'simplified' | 'unknown'

export interface ScriptDetection {
  source: SourceScript
  traditional: number
  simplified: number
  confidence: number
  hasChinese: boolean
  totalHan: number
}

const HAN = /^\p{Script=Han}$/u
const MIN_SIGNALS = 15

export function detectScript(
  sample: string,
  t2s: TextConverter,
  s2t: TextConverter,
): ScriptDetection {
  const cache = new Map<string, 0 | 1 | 2>()
  let traditional = 0
  let simplified = 0
  let totalHan = 0

  for (const ch of sample) {
    if (!HAN.test(ch)) continue
    totalHan++
    let kind = cache.get(ch)
    if (kind === undefined) {
      const asSimplified = t2s(ch)
      const asTraditional = s2t(ch)
      kind = 0
      if (asSimplified !== ch && asTraditional === ch) kind = 1
      else if (asTraditional !== ch && asSimplified === ch) kind = 2
      cache.set(ch, kind)
    }
    if (kind === 1) traditional++
    else if (kind === 2) simplified++
  }

  const hasChinese = totalHan >= 10
  const total = traditional + simplified
  let source: SourceScript = 'unknown'
  if (total >= MIN_SIGNALS) {
    source = traditional > simplified ? 'traditional' : 'simplified'
  }
  const confidence = total ? Math.round((Math.max(traditional, simplified) / total) * 100) : 0
  return { source, traditional, simplified, confidence, hasChinese, totalHan }
}
