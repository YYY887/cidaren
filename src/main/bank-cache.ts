/**
 * 题库缓存模块
 * 管理 bank.json 的读写，提供内存缓存和原子持久化。
 * 移植自 cidaren-main/cidaren/a.py (_bank_load, _bank_save, _topic_key)
 */

import * as fs from 'fs'
import * as path from 'path'
import type { Topic, BankEntry, CollocationRemark } from './types'

/**
 * 判断题目是否为搭配题
 * mode=31 且 stem.remark 是含 relation 字段的数组
 */
function isCollocationForKey(topic: Topic): boolean {
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
 * 生成题目唯一标识字符串
 * 格式: "{mode}::{kind}::{normalizedStem}::{remark}::{optionsHash}"
 */
export function topicKey(topic: Topic): string {
  const mode = topic.topic_mode ?? '?'
  const stem = topic.stem?.content ?? ''
  let remark: string = ''
  const rawRemark = topic.stem?.remark
  if (rawRemark) {
    if (Array.isArray(rawRemark)) {
      remark = JSON.stringify(rawRemark)
    } else {
      remark = rawRemark
    }
  }

  const opts = (topic.options ?? [])
    .map((o) => (o.content ?? '').slice(0, 20))
    .join('|')

  const sn = stem.replace(/\s+/g, ' ').trim().toLowerCase()
  const kind = isCollocationForKey(topic) ? 'coll' : 'norm'

  return `${mode}::${kind}::${sn}::${remark}::${opts.toLowerCase()}`
}

/**
 * 题库缓存管理器
 * 在内存中维护题库数据，支持原子写入持久化。
 */
export class BankCache {
  private bankFilePath: string
  private data: Record<string, BankEntry>

  constructor(bankFilePath: string) {
    this.bankFilePath = bankFilePath
    this.data = this.load()
  }

  /** 缓存条目数量 */
  get size(): number {
    return Object.keys(this.data).length
  }

  /**
   * 从 bank.json 加载题库
   * 文件不存在或损坏时返回空对象
   */
  load(): Record<string, BankEntry> {
    if (!fs.existsSync(this.bankFilePath)) {
      return {}
    }
    try {
      const content = fs.readFileSync(this.bankFilePath, 'utf-8')
      const parsed = JSON.parse(content)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, BankEntry>
      }
      return {}
    } catch {
      return {}
    }
  }

  /**
   * 原子持久化到 bank.json
   * 写入临时文件后 rename，确保写入原子性
   */
  save(bank?: Record<string, BankEntry>): void {
    const dataToSave = bank ?? this.data
    const dir = path.dirname(this.bankFilePath)

    // 确保目录存在
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const tmpPath = `${this.bankFilePath}.${process.pid}.tmp`
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(dataToSave, null, 1), 'utf-8')
      fs.renameSync(tmpPath, this.bankFilePath)
    } finally {
      // 清理临时文件（如果 rename 失败）
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath)
        }
      } catch {
        // ignore cleanup errors
      }
    }
  }

  /** 从内存缓存中获取条目 */
  get(key: string): BankEntry | undefined {
    return this.data[key]
  }

  /** 写入内存缓存 */
  set(key: string, entry: BankEntry): void {
    this.data[key] = entry
  }

  /** 生成题目唯一标识（代理到模块级函数） */
  topicKey(topic: Topic): string {
    return topicKey(topic)
  }
}
