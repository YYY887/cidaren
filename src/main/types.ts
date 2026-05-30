/**
 * 核心类型定义
 * 定义 cidaren-electron 应用中所有共享的接口和类型
 */

// ── 配置相关 ──

/** 运行时配置，从 .env 加载并与默认值合并 */
export interface RuntimeConfig {
  USERTOKEN: string
  ABC: string
  AUTH_V: string
  LLM_URL: string
  LLM_KEY: string
  LLM_MODEL: string
  COURSE_ID: string
  STUDY_GRADE: string
}

// ── 题目相关 ──

/** 题目选项 */
export interface Option {
  content: string
  answer_tag: number
}

/** 搭配题 remark 条目 */
export interface CollocationRemark {
  relation: string
  [key: string]: unknown
}

/** 题目数据 */
export interface Topic {
  topic_code: string
  /** 题目模式: 0=展示释义, 11=句中选义, 31=选择题, 32=组词题 */
  topic_mode: 0 | 11 | 31 | 32
  stem: {
    content: string
    remark: string | CollocationRemark[]
  }
  options: Option[]
  answer_num?: number
  topic_done_num?: number
  topic_total?: number
}

// ── API 相关 ──

/** vocabgo API 响应 */
export interface ApiResponse {
  code: number
  data: unknown
  /** 解密版本标识 */
  jv?: string
}

// ── 任务相关 ──

/** 启动任务请求载荷 */
export interface StartTaskPayload {
  source: 'class' | 'study'
  taskId: number
  releaseId: number | string
  courseId?: string
  listId?: string
  taskType?: number
  grade?: number
  loop: boolean
}

/** 停止任务请求载荷 */
export interface StopTaskPayload {
  source: 'class' | 'study'
  taskId: number
  releaseId: number | string
}

/** 任务信息 */
export interface TaskInfo {
  source: 'class' | 'study'
  sourceLabel: string
  taskId: number
  releaseId: number | string
  taskName: string
  progress: number
  score: number | null
  running: boolean
  done: boolean
  exitCode: number | null
  loop: boolean
  round: number
  canStart: boolean
  courseId?: string
  listId?: string
  taskType?: number
  grade?: number
}

/** 任务唯一标识: [source, taskId, releaseId] */
export type TaskKey = [string, string, string]

// ── 题库缓存相关 ──

/** 答案类型 */
export type Answer = number | string | number[]

/** 题库条目 */
export interface BankEntry {
  ans: Answer
  stem: string
}

// ── 答题参数 ──

/** 答题引擎参数 */
export interface QuizParams {
  taskId: number
  releaseId?: number | string
  courseId?: string
  listId?: string
  taskType?: number
  grade?: number
}

// ── 解密规则相关 ──

/** JV2 pluck 规则 */
export interface JvRule {
  s: number
  n: number
}

/** JV3 解密配置 */
export interface Jv3Config {
  uc: JvRule[]
  avg: number
  loc: number[]
}
