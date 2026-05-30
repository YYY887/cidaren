/**
 * QuizEngine - 答题引擎核心
 * 继承 EventEmitter，实现班级任务和自学任务的答题主循环。
 * 移植自 cidaren-main/cidaren/a.py 的 run_quiz, run_full, run_study_full
 */

import { EventEmitter } from 'events'
import type { VocabgoClient } from './vocabgo-client'
import type { BankCache } from './bank-cache'
import { topicKey } from './bank-cache'
import type { LLMClient } from './llm-client'
import type { Topic, Answer, CollocationRemark } from './types'
import {
  sleep,
  isCollocation,
  collectWordDefs,
  matchCollocation,
  matchAnswer,
} from './utils'

/** 从 API 响应中提取 topic 数据 */
function getTopic(resp: Record<string, unknown>): Topic | null {
  const d = (resp?.data ?? {}) as Record<string, unknown>
  if (typeof d === 'object' && d !== null && d.topic_code) {
    return d as unknown as Topic
  }
  const candidate =
    (d.topic_info as Topic) ??
    (d.topic as Topic) ??
    ((d.topic_list as Topic[] | undefined) ?? [])[0] ??
    null
  return candidate ?? null
}

/** 生成 [lo, hi] 之间的随机整数（毫秒） */
function randomMs(loSec: number, hiSec: number): number {
  return Math.round((loSec + Math.random() * (hiSec - loSec)) * 1000)
}

export class QuizEngine extends EventEmitter {
  private client: VocabgoClient
  private bankCache: BankCache
  private llmClient: LLMClient
  private abortController: AbortController

  constructor(client: VocabgoClient, bankCache: BankCache, llmClient: LLMClient) {
    super()
    this.client = client
    this.bankCache = bankCache
    this.llmClient = llmClient
    this.abortController = new AbortController()
  }

  /** 是否已中止 */
  private get aborted(): boolean {
    return this.abortController.signal.aborted
  }

  /** 获取中止信号 */
  private get signal(): AbortSignal {
    return this.abortController.signal
  }

  /** 中止答题 */
  abort(): void {
    this.abortController.abort()
  }

  /**
   * 运行班级任务
   * 流程: 获取任务信息 → 选词 → 答题主循环 → 签到
   */
  async runClassTask(taskId: number, releaseId: number): Promise<void> {
    try {
      if (this.aborted) { this.emit('done', 0); return }

      // 1. 获取任务信息
      const info = await this.client.taskInfo(taskId, releaseId)
      const infoData = (info.data ?? {}) as Record<string, unknown>
      this.emit('log', `📋 ${infoData.task_name ?? '?'}`)

      await sleep(0.5, 1.0, this.signal)
      if (this.aborted) { this.emit('done', 0); return }

      // 2. 获取选词列表，过滤 score < 10 的词
      const chose = await this.client.choseWordList(taskId)
      const choseData = (chose.data ?? {}) as Record<string, unknown>
      const words = (choseData.word_list as Array<Record<string, unknown>>) ?? []
      const todo = words.filter((w) => (w.score as number ?? 0) < 10)
      this.emit('log', `📝 总${words.length}词, 待练${todo.length}词`)

      // 3. 提交选词
      if (todo.length > 0) {
        if (this.aborted) { this.emit('done', 0); return }
        const wordMap: Record<string, string[]> = {}
        for (const w of todo) {
          const key = `${w.course_id}:${w.list_id}`
          if (!wordMap[key]) wordMap[key] = []
          wordMap[key].push(w.word as string)
        }
        await this.client.submitChoseWord(taskId, wordMap)
        await sleep(0.5, 1.0, this.signal)
      } else {
        this.emit('log', '全部满分, 跳过选词')
      }

      if (this.aborted) { this.emit('done', 0); return }

      // 4. 答题主循环
      await this.runQuiz('class', { taskId, releaseId })

      // 5. 签到
      if (this.aborted) { this.emit('done', 0); return }
      await sleep(0.5, 1.0, this.signal)
      try {
        const sr = await this.client.signin()
        const sd = (sr.data ?? {}) as Record<string, unknown>
        if (sd && (sd.sign_in_total !== undefined || sd.integral !== undefined)) {
          this.emit('log', `签到完成, 累计${sd.sign_in_total ?? '?'}天, 积分+${sd.integral ?? '?'}`)
        } else {
          this.emit('log', '签到完成')
        }
      } catch {
        this.emit('log', '签到请求失败（不影响答题结果）')
      }

      this.emit('done', 0)
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      this.emit('done', 1)
    }
  }

  /**
   * 运行自学任务
   * 流程: 创建/获取任务 → 获取信息 → 选词 → 答题主循环 → 签到
   */
  async runStudyTask(
    taskId: number,
    courseId: string,
    listId: string,
    taskType: number,
    grade: number
  ): Promise<void> {
    try {
      let currentTaskId = taskId

      if (this.aborted) { this.emit('done', 0); return }

      // 1. 如果 taskId <= 0，创建/获取任务
      if (currentTaskId <= 0) {
        const start = await this.client.studyStartTask(courseId, listId, taskType, grade)
        const sd = (start.data ?? {}) as Record<string, unknown>
        currentTaskId = (sd.task_id as number) ?? (sd.id as number) ?? currentTaskId

        if (currentTaskId <= 0) {
          // 从任务列表中查找
          const latest = await this.client.studyTaskList(courseId)
          const latestData = (latest.data ?? {}) as Record<string, unknown>
          const recs = (latestData.task_list as Array<Record<string, unknown>>) ?? []
          for (const r of recs) {
            if (String(r.list_id) === String(listId)) {
              currentTaskId = (r.task_id as number) ?? currentTaskId
              taskType = (r.task_type as number) ?? taskType
              grade = (r.grade as number) ?? grade
              courseId = (r.course_id as string) ?? courseId
              break
            }
          }
        }
        this.emit('log', `🆕 自学任务已创建/启动: task_id=${currentTaskId}`)
      }

      if (this.aborted) { this.emit('done', 0); return }

      // 2. 获取任务信息
      const info = await this.client.studyTaskInfo(currentTaskId, courseId, listId, taskType, grade)
      const infoData = (info.data ?? {}) as Record<string, unknown>
      this.emit('log', `📋 ${infoData.task_name ?? listId}`)

      await sleep(0.5, 1.0, this.signal)
      if (this.aborted) { this.emit('done', 0); return }

      // 3. 获取选词列表
      const chose = await this.client.studyChoseWordList(
        currentTaskId,
        courseId,
        listId,
        taskType,
        grade
      )
      const choseData = (chose.data ?? {}) as Record<string, unknown>
      const words = (choseData.word_list as Array<Record<string, unknown>>) ?? []

      if (words.length === 0) {
        this.emit('log', `⚠️ 自学选词列表为空/异常，停止进入答题`)
        this.emit('done', 1)
        return
      }

      const todo = words.filter((w) => (w.score as number ?? 0) < 10)
      this.emit('log', `📝 总${words.length}词, 待练${todo.length}词`)

      // 4. 提交选词
      if (todo.length > 0) {
        if (this.aborted) { this.emit('done', 0); return }
        const wordMap: Record<string, string[]> = {}
        for (const w of todo) {
          const key = `${(w.course_id as string) ?? courseId}:${(w.list_id as string) ?? listId}`
          if (!wordMap[key]) wordMap[key] = []
          wordMap[key].push(w.word as string)
        }
        await this.client.studySubmitChoseWord(
          currentTaskId,
          courseId,
          listId,
          wordMap,
          taskType,
          grade
        )
        await sleep(0.5, 1.0, this.signal)
      } else {
        this.emit('log', '全部满分, 跳过选词')
      }

      if (this.aborted) { this.emit('done', 0); return }

      // 5. 答题主循环
      await this.runQuiz('study', {
        taskId: currentTaskId,
        courseId,
        listId,
        taskType,
        grade,
      })

      // 6. 签到
      if (this.aborted) { this.emit('done', 0); return }
      await sleep(0.5, 1.0, this.signal)
      try {
        const sr = await this.client.signin()
        const sd = (sr.data ?? {}) as Record<string, unknown>
        if (sd && (sd.sign_in_total !== undefined || sd.integral !== undefined)) {
          this.emit('log', `签到完成, 累计${sd.sign_in_total ?? '?'}天, 积分+${sd.integral ?? '?'}`)
        } else {
          this.emit('log', '签到完成')
        }
      } catch {
        this.emit('log', '签到请求失败（不影响答题结果）')
      }

      this.emit('done', 0)
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      this.emit('done', 1)
    }
  }

  /**
   * 答题主循环
   * 获取题目 → 匹配答案 → verify → submit → 下一题
   */
  private async runQuiz(
    taskKind: 'class' | 'study',
    params: {
      taskId: number
      releaseId?: number
      courseId?: string
      listId?: string
      taskType?: number
      grade?: number
    }
  ): Promise<void> {
    const wordDefs = new Map<string, string[]>()
    this.emit('log', `📚 题库 ${this.bankCache.size} 条`)

    // 获取第一道题
    let resp: Record<string, unknown>
    if (this.aborted) return
    if (taskKind === 'study') {
      resp = await this.client.studyStartAnswer(
        params.taskId,
        params.courseId!,
        params.listId!,
        params.taskType,
        params.grade
      )
    } else {
      resp = await this.client.startAnswer(params.taskId, params.releaseId!)
    }

    let topic = getTopic(resp)
    if (!topic) {
      const code = resp.code as number | undefined
      const msg = (resp.msg as string) || ''
      if (code === 20006) {
        this.emit('log', `任务已截止，跳过`)
        this.emit('expired', params.taskId)
      } else {
        this.emit('log', `StartAnswer 失败: ${msg || JSON.stringify(resp)}`)
      }
      return
    }

    const respData = (resp.data ?? {}) as Record<string, unknown>
    let done = (respData.topic_done_num as number) ?? 0
    let total = (respData.topic_total as number) ?? 0
    this.emit('log', `🚀 开始 ${done}/${total}`)

    // 主循环
    while (topic && topic.topic_code && !this.aborted) {
      const code = topic.topic_code
      const mode = topic.topic_mode
      const stemObj = topic.stem ?? { content: '?', remark: '' }
      const stem = stemObj.content ?? '?'
      const remark = stemObj.remark ?? ''
      const doneNow = topic.topic_done_num ?? done
      const totalNow = topic.topic_total ?? total

      let saveResp: Record<string, unknown>

      if (mode === 0) {
        // ── 展示释义: 收集词义, 直接提交 ──
        collectWordDefs(topic, wordDefs)
        const opts = topic.options ?? []
        const defs = opts.map((o) => o.content).filter((c) => c)
        this.emit('log', `  [${doneNow}/${totalNow}] 📖 ${stem} (${defs.length}个释义)`)

        if (taskKind === 'study') {
          saveResp = await this.client.studySubmit(code, randomMs(0.5, 1.5))
        } else {
          saveResp = await this.client.submit(code, randomMs(0.5, 1.5))
        }
      } else if (isCollocation(topic)) {
        // ── 搭配题: 多选循环 verify ──
        saveResp = await this.handleCollocation(
          taskKind,
          topic,
          wordDefs,
          doneNow,
          totalNow
        )
      } else {
        // ── 标准选择题/组词题 ──
        saveResp = await this.handleStandardTopic(
          taskKind,
          topic,
          wordDefs,
          doneNow,
          totalNow
        )
      }

      if (this.aborted) return

      // 获取下一题
      const nextTopic = getTopic(saveResp)
      const saveData = (saveResp.data ?? {}) as Record<string, unknown>
      done = (saveData.topic_done_num as number) ?? done + 1
      total = (saveData.topic_total as number) ?? total

      if (
        !nextTopic ||
        !nextTopic.topic_code ||
        nextTopic.topic_code === topic.topic_code
      ) {
        this.emit(
          'log',
          `🎉 全部完成 ${done}/${total}, 题库 ${this.bankCache.size} 条, 词典 ${wordDefs.size} 词`
        )
        return
      }

      topic = nextTopic

      // 延时: mode=0 等待 0.3~0.6s，其他等待 2.0~4.0s
      await sleep(mode === 0 ? 0.3 : 2.0, mode === 0 ? 0.6 : 4.0, this.signal)
    }

    if (this.aborted) {
      this.emit('log', '⏹️ 任务已中止')
    }
  }

  /**
   * 处理搭配题（多选循环 verify）
   */
  private async handleCollocation(
    taskKind: 'class' | 'study',
    topic: Topic,
    wordDefs: Map<string, string[]>,
    doneNow: number,
    totalNow: number
  ): Promise<Record<string, unknown>> {
    const opts = topic.options ?? []
    const answerNum = topic.answer_num ?? 2
    const key = topicKey(topic)
    const stem = topic.stem?.content ?? '?'
    const remark = topic.stem?.remark

    // 获取候选答案 tag 列表
    let tags: number[] | null = null
    let src = ''

    // 1. 缓存
    const cached = this.bankCache.get(key)
    if (cached && Array.isArray(cached.ans)) {
      tags = [...(cached.ans as number[])]
      src = 'cache'
    }

    // 2. 规则匹配
    if (!tags) {
      tags = matchCollocation(remark as CollocationRemark[], opts)
      if (tags) src = 'match'
    }

    // 3. LLM
    if (!tags) {
      const aOne = await this.waitForLlmAnswer(topic, wordDefs, doneNow, totalNow)
      if (typeof aOne === 'number') {
        tags = [aOne]
        src = 'llm'
      }
    }

    if (!tags) {
      return this.finishCurrentTopicWithoutSubmit(topic)
    }

    const chosen: number[] = []
    const okTags: number[] = []
    let curCode = topic.topic_code

    for (const ansTag of tags.slice(0, answerNum)) {
      if (chosen.includes(ansTag)) continue

      let vr: Record<string, unknown>
      if (taskKind === 'study') {
        vr = await this.client.studyVerify(curCode, ansTag)
      } else {
        vr = await this.client.verify(curCode, ansTag)
      }

      const vd = (vr.data ?? {}) as Record<string, unknown>
      curCode = (vd.topic_code as string) ?? curCode

      if (vd.answer_result === 1) {
        okTags.push(ansTag)
      }
      chosen.push(ansTag)

      // 如果服务端给出 corrects，用它补充
      const cs = (vd.answer_corrects as number[]) ?? []
      if (cs.length > 0) {
        for (const c of cs) {
          if (!chosen.includes(c) && !okTags.includes(c)) {
            okTags.push(c)
          }
        }
      }

      if (vd.over_status === 1) {
        break
      }

      await sleep(0.5, 1.0, this.signal)
    }

    // 缓存正确答案
    if (okTags.length > 0) {
      this.bankCache.set(key, { ans: okTags, stem })
      this.bankCache.save()
    }

    const disp = (okTags.length > 0 ? okTags : chosen)
      .map((t) => this.dispAnswer(opts, t, topic.topic_mode))
      .join(',')
    const tag = okTags.length > 0 ? '✅' : '⚠️'
    this.emit('log', `  [${doneNow}/${totalNow}] ${tag} 🔗 ${stem} → ${disp} [${src}]`)

    // 提交
    const spent = randomMs(2.0, 4.0)
    if (taskKind === 'study') {
      return await this.client.studySubmit(curCode, spent)
    } else {
      return await this.client.submit(curCode, spent)
    }
  }

  /**
   * 处理标准选择题/组词题
   */
  private async handleStandardTopic(
    taskKind: 'class' | 'study',
    topic: Topic,
    wordDefs: Map<string, string[]>,
    doneNow: number,
    totalNow: number
  ): Promise<Record<string, unknown>> {
    const key = topicKey(topic)
    const opts = topic.options ?? []
    const stem = topic.stem?.content ?? '?'
    const remark = topic.stem?.remark ?? ''
    const mode = topic.topic_mode

    let answer: Answer | null = null
    let src = ''

    // 1. 题库缓存
    const cached = this.bankCache.get(key)
    if (cached) {
      answer = cached.ans
      src = 'cache'
    }

    // 2. 规则匹配
    if (answer === null) {
      answer = matchAnswer(topic, wordDefs)
      if (answer !== null) src = 'match'
    }

    // 3. LLM 兜底
    if (answer === null) {
      answer = await this.waitForLlmAnswer(topic, wordDefs, doneNow, totalNow)
      if (answer !== null) src = 'llm'
    }

    if (answer === null) {
      return this.finishCurrentTopicWithoutSubmit(topic)
    }

    // Verify
    let code = topic.topic_code
    let vr: Record<string, unknown>
    if (taskKind === 'study') {
      vr = await this.client.studyVerify(code, answer)
    } else {
      vr = await this.client.verify(code, answer)
    }

    const vd = (vr.data ?? {}) as Record<string, unknown>
    code = (vd.topic_code as string) ?? code
    const ar = vd.answer_result

    if (ar === 1) {
      // 正确：缓存答案
      if (!cached) {
        this.bankCache.set(key, { ans: answer, stem })
        this.bankCache.save()
      }
      const disp = this.dispAnswer(opts, answer, mode)
      this.emit(
        'log',
        `  [${doneNow}/${totalNow}] ✅ ${this.dispStem(stem, remark)} → ${disp} [${src}]`
      )
    } else {
      // 错误：用 answer_corrects 更新题库
      const corrects = (vd.answer_corrects as Answer[]) ?? []
      if (corrects.length > 0) {
        answer = corrects[0]
        this.bankCache.set(key, { ans: answer, stem })
        this.bankCache.save()
      }
      const disp = this.dispAnswer(opts, answer, mode)
      this.emit(
        'log',
        `  [${doneNow}/${totalNow}] ⚠️ ${this.dispStem(stem, remark)} → ${disp} [${src}→fix]`
      )
    }

    // Submit
    const spent = randomMs(2.0, 4.0)
    if (taskKind === 'study') {
      return await this.client.studySubmit(code, spent)
    } else {
      return await this.client.submit(code, spent)
    }
  }

  /**
   * 等待 LLM 给出答案。限速或临时失败时暂停当前题，不盲猜提交。
   */
  private async waitForLlmAnswer(
    topic: Topic,
    wordDefs: Map<string, string[]>,
    doneNow: number,
    totalNow: number
  ): Promise<Answer | null> {
    let retryCount = 0

    while (!this.aborted) {
      try {
        const answer = await this.llmClient.getAnswer(topic, wordDefs)
        if (answer !== null) {
          if (retryCount > 0) {
            this.emit('log', `    LLM 已恢复，继续答题`)
          }
          return answer
        }
      } catch (e) {
        this.emit('log', `    LLM 调用异常: ${e instanceof Error ? e.message : String(e)}`)
      }

      retryCount += 1
      this.emit('log', `    [${doneNow}/${totalNow}] LLM 暂不可用，暂停等待后重试（第 ${retryCount} 次）`)
      await sleep(20, 30, this.signal)
    }

    return null
  }

  /** 中止时返回当前题，避免在停止任务后继续提交答案。 */
  private finishCurrentTopicWithoutSubmit(topic: Topic): Record<string, unknown> {
    return {
      data: {
        topic_code: topic.topic_code,
        topic_done_num: topic.topic_done_num,
        topic_total: topic.topic_total,
      },
    }
  }

  /** 格式化显示 stem */
  private dispStem(stem: string, remark: string | CollocationRemark[]): string {
    let s = stem.slice(0, 35)
    if (Array.isArray(remark)) return s
    if (remark) s += ` (${(remark as string).slice(0, 10)})`
    return s
  }

  /** 格式化显示答案 */
  private dispAnswer(
    opts: Array<{ content: string; answer_tag: number }>,
    answer: Answer,
    mode: number
  ): string {
    if (mode === 32 && typeof answer === 'string') {
      return answer.slice(0, 30)
    }
    if (typeof answer === 'number' && answer >= 0 && answer < opts.length) {
      return (opts[answer]?.content ?? '?').slice(0, 30)
    }
    return String(answer).slice(0, 30)
  }
}
