/**
 * LLMClient - OpenAI 兼容接口调用
 * 根据题目模式构造 prompt，调用 chat/completions 获取答案
 * 支持全局限速队列与重试退避，降低触发 too many requests 的概率
 */

import got from 'got'
import * as https from 'https'
import * as http from 'http'
import type { Topic, Answer } from './types'

/** 直连 agent，绕过系统代理 */
const directAgent = {
  http: new http.Agent(),
  https: new https.Agent(),
}

export interface LLMConfig {
  llmUrl: string
  llmKey: string
  llmModel: string
}

/**
 * 构建 chat/completions URL
 * 如果 base 以 /v1 结尾，直接追加 /chat/completions
 * 否则追加 /v1/chat/completions
 */
function chatCompletionsUrl(llmUrl: string): string {
  const base = llmUrl.replace(/\/+$/, '')
  if (base.endsWith('/v1')) {
    return `${base}/chat/completions`
  }
  return `${base}/v1/chat/completions`
}

/**
 * 延时工具
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 从 HTTP 响应头中读取 Retry-After，单位转换为毫秒 */
function retryAfterMs(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null

  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000
  }

  const time = Date.parse(raw)
  if (Number.isFinite(time)) {
    return Math.max(0, time - Date.now())
  }

  return null
}

/** 判断是否是接口限速类错误 */
function isRateLimit(statusCode: number, message: string): boolean {
  const msg = message.toLowerCase()
  return statusCode === 429 || msg.includes('too many') || msg.includes('rate limit') || msg.includes('ratelimit')
}

/** 添加少量随机抖动，避免固定节奏撞限速窗口 */
function jitter(ms: number): number {
  return Math.round(ms + Math.random() * 800)
}

export class LLMClient {
  private config: LLMConfig

  /** 所有 LLMClient 实例共享队列，避免多个任务并发请求 LLM */
  private static queue: Promise<void> = Promise.resolve()
  private static lastRequestAt = 0
  private static rateLimitedUntil = 0
  private static readonly minRequestIntervalMs = 2500
  private static readonly maxAttempts = 5

  constructor(config: LLMConfig) {
    this.config = config
  }

  /**
   * 全局请求调度：串行化所有 LLM 请求，并保证请求之间至少间隔一段时间。
   */
  private async waitForTurn(): Promise<void> {
    const previous = LLMClient.queue
    let release!: () => void
    LLMClient.queue = new Promise((resolve) => {
      release = resolve
    })

    await previous

    const now = Date.now()
    const waitForInterval = Math.max(0, LLMClient.lastRequestAt + LLMClient.minRequestIntervalMs - now)
    const waitForCooldown = Math.max(0, LLMClient.rateLimitedUntil - now)
    const waitMs = Math.max(waitForInterval, waitForCooldown)

    if (waitMs > 0) {
      await sleep(waitMs)
    }

    LLMClient.lastRequestAt = Date.now()
    release()
  }

  /**
   * 获取 LLM 答案
   * 返回 Answer (number | string | number[]) 或 null
   */
  async getAnswer(topic: Topic, wordDefs: Map<string, string[]>): Promise<Answer | null> {
    const { llmUrl, llmKey, llmModel } = this.config

    // 未配置时直接返回 null
    if (!llmUrl?.trim() || !llmKey?.trim()) {
      return null
    }

    const model = llmModel?.trim() || 'step-3.6'
    const prompt = this.buildPrompt(topic, wordDefs)
    const url = chatCompletionsUrl(llmUrl)

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmKey}`,
      'X-LLM-TAG': 'data_annotation',
    }

    const data = {
      model,
      messages: [
        {
          role: 'system',
          content: '你是英语词汇专家。请精准回答，只输出答案，不要解释。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 64,
    }

    // 重试逻辑: 普通错误短退避；限速错误按 Retry-After 或指数退避进入全局冷却。
    let lastErr: unknown = null
    for (let attempt = 0; attempt < LLMClient.maxAttempts; attempt++) {
      try {
        await this.waitForTurn()

        const resp = await got(url, {
          method: 'POST',
          headers,
          json: data,
          timeout: { request: 60000 },
          responseType: 'json',
          agent: directAgent,
          throwHttpErrors: false,
        })

        if (resp.statusCode !== 200) {
          const errBody = resp.body as Record<string, unknown>
          const errMsg = (errBody.error as Record<string, unknown>)?.message || (errBody.message as string) || `HTTP ${resp.statusCode}`
          lastErr = new Error(String(errMsg))

          if (attempt < LLMClient.maxAttempts - 1) {
            let waitMs = jitter(1500 * (attempt + 1))
            if (isRateLimit(resp.statusCode, String(errMsg))) {
              waitMs = retryAfterMs(resp.headers['retry-after']) ?? jitter(8000 * 2 ** attempt)
              LLMClient.rateLimitedUntil = Math.max(LLMClient.rateLimitedUntil, Date.now() + waitMs)
              console.warn(`[LLM] 触发限速，等待 ${Math.round(waitMs / 1000)} 秒后重试`)
            }

            await sleep(waitMs)
            continue
          }
          break
        }

        const body = resp.body as Record<string, unknown>
        const choices = body.choices as Array<{ message: { content: string } }> | undefined
        if (!choices || choices.length === 0) {
          return null
        }

        const ansText = choices[0].message.content.trim()
        return this.parseResponse(ansText, topic.topic_mode)
      } catch (err) {
        lastErr = err
        if (attempt < LLMClient.maxAttempts - 1) {
          await sleep(jitter(1500 * (attempt + 1)))
          continue
        }
      }
    }

    // 所有重试失败 - 输出错误信息
    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr)
    console.error(`[LLM] 请求失败 (${this.config.llmUrl}): ${errMsg}`)
    return null
  }

  /**
   * 根据 topic_mode 构造 prompt
   */
  private buildPrompt(topic: Topic, wordDefs: Map<string, string[]>): string {
    const mode = topic.topic_mode
    const stem = topic.stem.content
    const remark = topic.stem.remark || ''
    const opts = topic.options
    const optsStr = opts.map((o, i) => `${i}. ${o.content}`).join('\n')

    // 构建 word_defs 上下文
    let wdStr = ''
    if (wordDefs.size > 0) {
      const entries = Array.from(wordDefs.entries()).slice(0, 40)
      const wdLines = entries.map(([w, ds]) => `  ${w}: ${ds.join('; ')}`)
      wdStr = '已知单词释义:\n' + wdLines.join('\n') + '\n\n'
    }

    if (mode === 32) {
      return `${wdStr}题目: 用选项中的词组成短语, 中文含义是「${remark}」
空格数: ${stem}
选项:
${optsStr}

请选出正确的词并按正确顺序排列。只回答逗号分隔的选项内容(如: in,many,instances), 不要其他文字。`
    }

    if (mode === 31) {
      return `${wdStr}题目: 以下哪个是单词「${stem}」的正确释义?
选项:
${optsStr}

只回答选项编号(如: 0), 不要其他文字。`
    }

    if (mode === 11) {
      const rk = remark ? `句子中文翻译(参考): ${remark}\n` : ''
      return `${wdStr}题目: 根据句意选择句中 {} 内单词的正确释义
句子: ${stem}
${rk}选项:
${optsStr}

注意: 单词常有多个词义和词性, 必须结合上下文和中文翻译判断该词在此句中的具体含义。
只回答选项编号(如: 0), 不要其他文字。`
    }

    // 其他 mode（fallback）
    return `${wdStr}题目 (mode=${mode}):
题干: ${stem}
备注: ${remark}
选项:
${optsStr}

选择正确答案。如果是选择题回答编号(如: 0); 如果是组词题回答逗号分隔的词(如: in,many,instances)。不要其他文字。`
  }

  /**
   * 解析 LLM 响应
   * mode=32: 返回文本（逗号分隔的词）
   * 其他: 提取第一个数字
   */
  private parseResponse(ansText: string, mode: number): Answer | null {
    if (mode === 32) {
      return ansText
    }

    const m = ansText.match(/\d+/)
    if (m) {
      return parseInt(m[0], 10)
    }

    return null
  }
}
