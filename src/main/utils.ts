/**
 * 工具函数模块
 * 包含答案匹配、搭配题判断、词义收集等核心工具。
 * 移植自 cidaren-main/cidaren/a.py
 */

import type { Topic, Option, CollocationRemark, Answer } from './types'

/**
 * 随机延时
 * @param lo 最小延时（秒）
 * @param hi 最大延时（秒）
 * @param signal 可选的 AbortSignal，中止时立即 resolve
 * @returns Promise，在 [lo, hi] 秒之间的随机时间后 resolve
 */
export function sleep(lo: number, hi: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  const ms = (lo + Math.random() * (hi - lo)) * 1000
  return new Promise((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout

    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }

    timer = setTimeout(done, ms)
    if (signal) {
      signal.addEventListener('abort', done, { once: true })
    }
  })
}

/**
 * 规范化字符串：去除所有空白、转小写
 */
export function norm(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/**
 * 判断题目是否为搭配题
 * 条件: mode=31 且 stem.remark 是数组，且第一个元素是含 "relation" 属性的对象
 */
export function isCollocation(topic: Topic): boolean {
  if (topic.topic_mode !== 31) return false
  const rk = topic.stem?.remark
  return (
    Array.isArray(rk) &&
    rk.length > 0 &&
    typeof rk[0] === 'object' &&
    rk[0] !== null &&
    'relation' in rk[0]
  )
}

/**
 * 收集词义定义
 * 对于 mode=0 的展示释义题，将选项内容作为 stem 单词的释义收集到 wordDefs 中
 */
export function collectWordDefs(
  topic: Topic,
  wordDefs: Map<string, string[]>
): void {
  if (topic.topic_mode !== 0) return

  const word = (topic.stem?.content ?? '').replace(/\s+/g, '').toLowerCase()
  if (!word) return

  const defs = (topic.options ?? [])
    .map((o) => o.content ?? '')
    .filter((c) => c.length > 0)

  if (defs.length > 0) {
    wordDefs.set(word, defs)
  }
}

/**
 * 搭配题匹配
 * 从 remark 数组中提取所有 relation 值，匹配选项内容，返回匹配的 answer_tag 列表
 */
export function matchCollocation(
  remarkList: CollocationRemark[],
  opts: Option[]
): number[] | null {
  if (!Array.isArray(remarkList)) return null

  const relations = new Set<string>()
  for (const r of remarkList) {
    if (typeof r === 'object' && r !== null) {
      const rel = (r.relation ?? '').trim().toLowerCase()
      if (rel) {
        relations.add(rel)
      }
    }
  }

  if (relations.size === 0) return null

  const tags: number[] = []
  for (const opt of opts) {
    const c = (opt.content ?? '').trim().toLowerCase()
    if (relations.has(c)) {
      tags.push(opt.answer_tag)
    }
  }

  return tags.length > 0 ? tags : null
}

/**
 * 词义匹配
 * 在 wordDefs 中查找 target 单词的释义，与选项内容进行匹配
 * 匹配策略:
 * 1. 精确匹配或前缀匹配找到释义列表
 * 2. 规范化后比较（相等、包含关系）
 * 3. 关键词拆分匹配
 */
export function matchWordToDef(
  target: string,
  opts: Option[],
  wordDefs: Map<string, string[]>
): number | null {
  let defs = wordDefs.get(target) ?? null

  // 前缀匹配
  if (!defs) {
    for (const [bw, bwDefs] of wordDefs) {
      if (target.startsWith(bw) || bw.startsWith(target)) {
        defs = bwDefs
        break
      }
    }
  }

  if (!defs) return null

  // 第一轮：规范化后比较
  const defsNorm = defs.map((d) => norm(d))
  for (let i = 0; i < opts.length; i++) {
    const ot = norm(opts[i].content ?? '')
    for (const dn of defsNorm) {
      if (ot === dn || dn.includes(ot) || ot.includes(dn)) {
        return opts[i].answer_tag ?? i
      }
    }
  }

  // 第二轮：关键词拆分匹配
  for (let i = 0; i < opts.length; i++) {
    const ot = opts[i].content ?? ''
    for (const d of defs) {
      // 去除词性前缀 (如 "n. ", "v. ")
      const core = d.replace(/^[a-z]+\.\s*/, '')
      const kws = core
        .split(/[；;，,]/)
        .map((kw) => kw.trim())
        .filter((kw) => kw.length >= 2)
      for (const kw of kws) {
        if (ot.includes(kw)) {
          return opts[i].answer_tag ?? i
        }
      }
    }
  }

  return null
}

/**
 * 答案匹配主入口
 * 根据题目模式路由到对应的匹配策略:
 * - 搭配题 → matchCollocation
 * - mode=32 → null (交给 LLM)
 * - mode=11 → null (交给 LLM)
 * - mode=31 或其他 → matchWordToDef
 */
export function matchAnswer(
  topic: Topic,
  wordDefs: Map<string, string[]>
): Answer | null {
  const mode = topic.topic_mode
  const stem = topic.stem?.content ?? ''
  const remark = topic.stem?.remark
  const opts = topic.options ?? []

  // 搭配题: remark 是数组
  if (isCollocation(topic)) {
    return matchCollocation(remark as CollocationRemark[], opts)
  }

  // mode=32: 组词题 → 交给 LLM
  if (mode === 32) return null

  // mode=11: 句中选义 → 交给 LLM
  if (mode === 11) return null

  // mode=31 或其他选择题: stem 是单词, 选项是释义
  if (mode === 31 || (mode !== null && mode !== undefined && mode !== 0)) {
    const word = stem.replace(/\s+/g, '').toLowerCase()
    if (word && !word.startsWith('_')) {
      return matchWordToDef(word, opts, wordDefs)
    }
  }

  return null
}
