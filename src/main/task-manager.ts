/**
 * TaskManager - 任务生命周期管理
 * 管理多个并发答题任务的启动、停止、日志和循环模式。
 * 移植自 cidaren-main/cidaren/web.py 的 JOBS 管理逻辑
 */

import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import type { ConfigManager } from './config-manager'
import type { BankCache } from './bank-cache'
import { VocabgoClient } from './vocabgo-client'
import { LLMClient } from './llm-client'
import { QuizEngine } from './quiz-engine'
import type { StartTaskPayload, StopTaskPayload, TaskInfo } from './types'

const LOG_MAX = 500

/** 任务唯一标识字符串 */
function taskKeyStr(source: string, taskId: number, releaseId: number | string): string {
  return `${source}:${taskId}:${releaseId}`
}

/** 任务运行状态 */
interface JobState {
  engine: QuizEngine
  logs: string[]
  done: boolean
  exitCode: number | null
  loop: boolean
  stopped: boolean
  round: number
  source: 'class' | 'study'
  taskId: number
  releaseId: number | string
  courseId?: string
  listId?: string
  taskType?: number
  grade?: number
}

export interface RunningTaskSummary {
  key: string
  label: string
  detail: string
  progress: string
  lastLog: string
}

export class TaskManager extends EventEmitter {
  private configManager: ConfigManager
  private bankCache: BankCache
  private jobs: Map<string, JobState> = new Map()
  private expiredTasks: Set<string> = new Set()
  private expiredFilePath: string
  private tasksCachePath: string
  private cachedTasks: TaskInfo[] = []

  constructor(configManager: ConfigManager, bankCache: BankCache, userDataDir?: string) {
    super()
    this.configManager = configManager
    this.bankCache = bankCache
    const dir = userDataDir || '.'
    this.expiredFilePath = path.join(dir, 'expired-tasks.json')
    this.tasksCachePath = path.join(dir, 'tasks-cache.json')
    this.loadExpiredTasks()
    this.loadTasksCache()
  }

  /** 从磁盘加载已过期任务集合 */
  private loadExpiredTasks(): void {
    try {
      if (fs.existsSync(this.expiredFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.expiredFilePath, 'utf-8'))
        if (Array.isArray(data)) {
          this.expiredTasks = new Set(data)
        }
      }
    } catch { /* ignore */ }
  }

  /** 将已过期任务集合持久化到磁盘 */
  private saveExpiredTasks(): void {
    try {
      const dir = path.dirname(this.expiredFilePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.expiredFilePath, JSON.stringify([...this.expiredTasks]), 'utf-8')
    } catch { /* ignore */ }
  }

  /** 从磁盘加载任务缓存 */
  private loadTasksCache(): void {
    try {
      if (fs.existsSync(this.tasksCachePath)) {
        const data = JSON.parse(fs.readFileSync(this.tasksCachePath, 'utf-8'))
        if (Array.isArray(data)) {
          this.cachedTasks = data
        }
      }
    } catch { /* ignore */ }
  }

  /** 将任务列表缓存到磁盘 */
  private saveTasksCache(tasks: TaskInfo[]): void {
    try {
      const dir = path.dirname(this.tasksCachePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.tasksCachePath, JSON.stringify(tasks, null, 1), 'utf-8')
      this.cachedTasks = tasks
    } catch { /* ignore */ }
  }

  /**
   * 列出所有任务（班级 + 自学），合并运行状态
   */
  async listTasks(): Promise<{ tasks: TaskInfo[]; warnings: string[] }> {
    const config = this.configManager.getConfig()
    const missing = this.configManager.getMissingAuthFields(config)
    if (missing.length > 0) {
      throw new Error(`请先在配置面板填写: ${missing.join(', ')}`)
    }

    const client = new VocabgoClient(config.USERTOKEN, config.ABC, config.AUTH_V)
    const courseId = (config.COURSE_ID || 'CET4_v2').trim() || 'CET4_v2'
    const studyGrade = parseInt(config.STUDY_GRADE, 10) || 2

    const tasks: TaskInfo[] = []
    const warnings: string[] = []

    // 班级任务
    try {
      const classTasks = await this.fetchClassTasks(client)
      for (const r of classTasks) {
        const tid = r.task_id as number
        const rid = r.release_id as number
        const key = taskKeyStr('class', tid, rid)
        const job = this.jobs.get(key)
        const expired = this.expiredTasks.has(key)
        tasks.push({
          source: 'class',
          sourceLabel: '班级',
          taskId: tid,
          releaseId: rid,
          taskName: (r.task_name as string) ?? '',
          progress: (r.progress as number) ?? 0,
          score: (r.score as number) ?? null,
          running: !!(job && !job.done),
          done: !!(job && job.done),
          exitCode: job ? job.exitCode : null,
          loop: !!(job && job.loop),
          round: job ? job.round : 0,
          canStart: !expired,
        })
      }
    } catch (e) {
      warnings.push(`班级任务读取失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    // 自学任务
    try {
      const studyTasks = await this.fetchStudyTasks(client, courseId)
      for (const r of studyTasks) {
        const tid = r.task_id as number
        const rid = (r.list_id as string) ?? ''
        const key = taskKeyStr('study', tid, rid)
        const job = this.jobs.get(key)
        const expired = this.expiredTasks.has(key)
        tasks.push({
          source: 'study',
          sourceLabel: '自学',
          taskId: tid,
          releaseId: rid,
          taskName: (r.task_name as string) ?? '',
          progress: (r.progress as number) ?? 0,
          score: (r.score as number) ?? null,
          running: !!(job && !job.done),
          done: !!(job && job.done),
          exitCode: job ? job.exitCode : null,
          loop: !!(job && job.loop),
          round: job ? job.round : 0,
          canStart: !expired,
          courseId: (r.course_id as string) ?? courseId,
          listId: rid,
          taskType: (r.task_type as number) ?? undefined,
          grade: (r.grade as number) ?? studyGrade,
        })
      }
    } catch (e) {
      warnings.push(`自学任务读取失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    // 缓存任务列表到本地
    if (tasks.length > 0) {
      this.saveTasksCache(tasks)
    }

    return { tasks, warnings }
  }

  /**
   * 获取缓存的任务列表（离线或加载失败时使用）
   */
  getCachedTasks(): TaskInfo[] {
    return this.cachedTasks.map(t => {
      const key = taskKeyStr(t.source, t.taskId, t.releaseId)
      const job = this.jobs.get(key)
      const expired = this.expiredTasks.has(key)
      return {
        ...t,
        running: !!(job && !job.done),
        done: !!(job && job.done),
        exitCode: job ? job.exitCode : null,
        loop: !!(job && job.loop),
        round: job ? job.round : 0,
        canStart: !expired,
      }
    })
  }

  /** 获取当前正在运行的任务摘要，用于托盘菜单展示 */
  getRunningTaskSummaries(): RunningTaskSummary[] {
    const summaries: RunningTaskSummary[] = []

    for (const [key, job] of this.jobs) {
      if (job.done || job.stopped) continue

      const sourceLabel = job.source === 'class' ? '班级' : '自学'
      const cached = this.cachedTasks.find(
        (task) => task.source === job.source && task.taskId === job.taskId && String(task.releaseId) === String(job.releaseId)
      )
      const taskName = cached?.taskName?.trim() || `${sourceLabel}任务 ${job.taskId}`
      const lastLog = job.logs.length > 0 ? job.logs[job.logs.length - 1] : '正在运行...'
      const progress = this.extractProgress(job.logs)

      summaries.push({
        key,
        label: `${sourceLabel} · ${taskName}`,
        detail: `第 ${job.round} 轮 · ${job.loop ? '循环模式' : '单次任务'}`,
        progress,
        lastLog,
      })
    }

    return summaries
  }

  /** 从日志里提取最近的答题进度，如 [12/50] 或 开始 0/50。 */
  private extractProgress(logs: string[]): string {
    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i]
      const match = log.match(/(?:\[|开始\s+|全部完成\s+)(\d+)\/(\d+)(?:\])?/)
      if (!match) continue

      const done = Number(match[1])
      const total = Number(match[2])
      if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) continue

      const percent = Math.max(0, Math.min(100, Math.round((done / total) * 100)))
      return `进度 ${done}/${total} (${percent}%)`
    }

    return '进度等待中'
  }

  /**
   * 启动任务
   */
  startTask(payload: StartTaskPayload): void {
    const key = taskKeyStr(payload.source, payload.taskId, payload.releaseId)

    // 拒绝重复启动
    const existing = this.jobs.get(key)
    if (existing && !existing.done) {
      throw new Error('任务正在运行')
    }

    const config = this.configManager.getConfig()
    const missing = this.configManager.getMissingAuthFields(config)
    if (missing.length > 0) {
      throw new Error(`请先填写配置: ${missing.join(', ')}`)
    }

    const client = new VocabgoClient(config.USERTOKEN, config.ABC, config.AUTH_V)
    const llmClient = new LLMClient({
      llmUrl: config.LLM_URL,
      llmKey: config.LLM_KEY,
      llmModel: config.LLM_MODEL,
    })

    // 调试: 确认 LLM 配置已加载
    if (config.LLM_URL && config.LLM_KEY) {
      this.appendLog(key, `LLM 已配置: ${config.LLM_MODEL}@${config.LLM_URL}`)
    } else {
      this.appendLog(key, 'LLM 未配置，将使用盲猜模式')
    }

    const engine = new QuizEngine(client, this.bankCache, llmClient)

    // 保留旧日志（循环模式下追加）
    const oldJob = this.jobs.get(key)
    const logs = oldJob ? oldJob.logs : []
    const round = oldJob ? oldJob.round + 1 : 1

    if (oldJob) {
      logs.push(`========== 第 ${round} 轮启动 ==========`)
      this.trimLogs(logs)
    }

    const job: JobState = {
      engine,
      logs,
      done: false,
      exitCode: null,
      loop: payload.loop,
      stopped: false,
      round,
      source: payload.source,
      taskId: payload.taskId,
      releaseId: payload.releaseId,
      courseId: payload.courseId,
      listId: payload.listId,
      taskType: payload.taskType,
      grade: payload.grade,
    }

    this.jobs.set(key, job)
    this.emit('status-changed')

    // 监听引擎事件
    engine.on('log', (msg: string) => {
      this.appendLog(key, msg)
    })

    engine.on('done', (exitCode: number) => {
      job.done = true
      job.exitCode = exitCode
      this.emit('status-changed')
      this.emit('done', key)
      this.handleLoopRestart(key, job)
    })

    engine.on('expired', () => {
      // 任务已截止，停止循环
      job.loop = false
      job.stopped = true
      this.expiredTasks.add(key)
      this.saveExpiredTasks()
      this.emit('status-changed')
      this.emit('done', key)
    })

    engine.on('error', (err: Error) => {
      this.appendLog(key, `错误: ${err.message}`)
    })

    // 异步启动任务
    this.runEngine(engine, payload)
  }

  /**
   * 停止任务
   */
  stopTask(payload: StopTaskPayload): void {
    const key = taskKeyStr(payload.source, payload.taskId, payload.releaseId)
    const job = this.jobs.get(key)
    if (!job) {
      throw new Error('任务未运行')
    }

    // 标记 stopped，阻断循环重启
    job.stopped = true
    job.loop = false
    job.done = true

    if (job.engine) {
      job.engine.abort()
    }

    this.appendLog(key, '任务已手动停止')
    this.emit('status-changed')
    this.emit('done', key)
  }

  /**
   * 获取任务日志
   */
  getTaskLogs(key: string): { logs: string[]; done: boolean; exitCode: number | null } {
    const job = this.jobs.get(key)
    if (!job) {
      return { logs: [], done: false, exitCode: null }
    }
    return {
      logs: [...job.logs],
      done: job.done,
      exitCode: job.exitCode,
    }
  }

  /**
   * 停止所有任务（应用退出时调用）
   */
  stopAll(): void {
    for (const [, job] of this.jobs) {
      job.stopped = true
      job.loop = false
      if (!job.done) {
        job.engine.abort()
      }
    }
  }

  /** 拉取班级任务（多页） */
  private async fetchClassTasks(
    client: VocabgoClient
  ): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = []
    let page = 1
    while (true) {
      const resp = await client.pageTask(page, 50)
      const data = (resp.data ?? {}) as Record<string, unknown>
      const recs = (data.records as Array<Record<string, unknown>>) ?? []
      if (recs.length === 0) break
      out.push(...recs)
      if (recs.length < 50) break
      page++
      if (page > 20) break
    }
    return out
  }

  /** 拉取自学任务 */
  private async fetchStudyTasks(
    client: VocabgoClient,
    courseId: string
  ): Promise<Array<Record<string, unknown>>> {
    const resp = await client.studyTaskList(courseId)
    const data = (resp.data ?? {}) as Record<string, unknown>
    return (data.task_list as Array<Record<string, unknown>>) ?? []
  }

  /** 异步运行引擎 */
  private runEngine(engine: QuizEngine, payload: StartTaskPayload): void {
    if (payload.source === 'study') {
      engine
        .runStudyTask(
          payload.taskId,
          payload.courseId ?? 'CET4_v2',
          payload.listId ?? String(payload.releaseId),
          payload.taskType ?? 3,
          payload.grade ?? 2
        )
        .catch((err) => {
          const key = taskKeyStr(payload.source, payload.taskId, payload.releaseId)
          this.appendLog(key, `❌ 未捕获错误: ${err instanceof Error ? err.message : String(err)}`)
        })
    } else {
      engine.runClassTask(payload.taskId, payload.releaseId as number).catch((err) => {
        const key = taskKeyStr(payload.source, payload.taskId, payload.releaseId)
        this.appendLog(key, `❌ 未捕获错误: ${err instanceof Error ? err.message : String(err)}`)
      })
    }
  }

  /** 循环模式：完成后查询分数，未满分则重启 */
  private async handleLoopRestart(key: string, job: JobState): Promise<void> {
    if (!job.loop || job.stopped) return

    try {
      const score = await this.queryScore(job)
      if (score !== null && score >= 100) {
        this.appendLog(key, `[loop] 已满分 (${score}), 停止循环`)
        return
      }
      this.appendLog(key, `[loop] 当前分数=${score}, 5s 后重新启动...`)
    } catch (e) {
      this.appendLog(key, `[loop] 查询分数失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    // 等待 5s
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // 再次检查是否被手动停止（从 map 中重新读取最新状态）
    const currentJob = this.jobs.get(key)
    if (!currentJob || currentJob.stopped || !currentJob.loop) {
      this.appendLog(key, '[loop] 循环已被手动停止')
      return
    }

    // 重新启动
    this.startTask({
      source: job.source,
      taskId: job.taskId,
      releaseId: job.releaseId,
      courseId: job.courseId,
      listId: job.listId,
      taskType: job.taskType,
      grade: job.grade,
      loop: true,
    })
  }

  /** 查询单个任务当前分数 */
  private async queryScore(job: JobState): Promise<number | null> {
    const config = this.configManager.getConfig()
    const client = new VocabgoClient(config.USERTOKEN, config.ABC, config.AUTH_V)

    if (job.source === 'study') {
      const resp = await client.studyTaskList(job.courseId ?? 'CET4_v2')
      const data = (resp.data ?? {}) as Record<string, unknown>
      const recs = (data.task_list as Array<Record<string, unknown>>) ?? []
      for (const r of recs) {
        if (
          String(r.list_id) === String(job.listId ?? job.releaseId) ||
          String(r.task_id) === String(job.taskId)
        ) {
          return (r.score as number) ?? null
        }
      }
      return null
    }

    // 班级任务：翻页查找
    let page = 1
    while (page <= 20) {
      const resp = await client.pageTask(page, 50)
      const data = (resp.data ?? {}) as Record<string, unknown>
      const recs = (data.records as Array<Record<string, unknown>>) ?? []
      if (recs.length === 0) return null
      for (const r of recs) {
        if (r.task_id === job.taskId && r.release_id === job.releaseId) {
          return (r.score as number) ?? null
        }
      }
      if (recs.length < 50) return null
      page++
    }
    return null
  }

  /** 追加日志到环形缓冲区 */
  private appendLog(key: string, message: string): void {
    const job = this.jobs.get(key)
    if (!job) return
    job.logs.push(message)
    this.trimLogs(job.logs)
    this.emit('log', key, message)
    this.emit('status-changed')
  }

  /** 裁剪日志到最大长度 */
  private trimLogs(logs: string[]): void {
    while (logs.length > LOG_MAX) {
      logs.shift()
    }
  }
}
