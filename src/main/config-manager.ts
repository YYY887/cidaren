/**
 * 配置管理模块
 * 使用 JSON 文件存储配置（不再使用 .env）
 */

import * as fs from 'fs'
import * as path from 'path'
import type { RuntimeConfig } from './types'

/** 所有配置字段名 */
export const CONFIG_FIELDS: (keyof RuntimeConfig)[] = [
  'USERTOKEN',
  'ABC',
  'AUTH_V',
  'LLM_URL',
  'LLM_KEY',
  'LLM_MODEL',
  'COURSE_ID',
  'STUDY_GRADE'
]

/** 默认配置值 */
export const DEFAULT_CONFIG: RuntimeConfig = {
  USERTOKEN: '',
  ABC: '',
  AUTH_V: '',
  LLM_URL: 'https://ai.saurlax.com/v1',
  LLM_KEY: '',
  LLM_MODEL: 'step-3.6',
  COURSE_ID: 'CET4_v2',
  STUDY_GRADE: '2'
}

/** 必填鉴权字段 */
export const REQUIRED_AUTH_FIELDS: (keyof RuntimeConfig)[] = ['USERTOKEN', 'ABC', 'AUTH_V']

/**
 * 配置管理器
 * 使用 JSON 文件持久化配置
 */
export class ConfigManager {
  private configPath: string
  private cache: RuntimeConfig | null = null

  constructor(baseDir: string, configFileName = 'config.json') {
    this.configPath = path.join(baseDir, configFileName)
  }

  /** 获取配置文件路径 */
  getEnvFilePath(): string {
    return this.configPath
  }

  /** 获取运行时配置 */
  getConfig(): RuntimeConfig {
    if (this.cache) return { ...this.cache }

    const config: RuntimeConfig = { ...DEFAULT_CONFIG }
    const saved = this.loadFile()

    for (const key of CONFIG_FIELDS) {
      if (key in saved && saved[key]) {
        config[key] = saved[key]
      }
    }

    this.cache = config
    return { ...config }
  }

  /** 保存配置 */
  saveConfig(payload: Partial<RuntimeConfig>): RuntimeConfig {
    const current = this.getConfig()

    for (const key of CONFIG_FIELDS) {
      if (!(key in payload)) continue
      const value = payload[key]
      current[key] = value == null ? '' : String(value).trim()
    }

    this.writeFile(current)
    this.cache = current
    return { ...current }
  }

  /** 检查缺失的必填鉴权字段 */
  getMissingAuthFields(config?: RuntimeConfig): string[] {
    const cfg = config ?? this.getConfig()
    return REQUIRED_AUTH_FIELDS.filter((key) => !(cfg[key] || '').trim())
  }

  /** 从 JSON 文件加载 */
  private loadFile(): Record<string, string> {
    if (!fs.existsSync(this.configPath)) {
      return {}
    }
    try {
      const content = fs.readFileSync(this.configPath, 'utf-8')
      const parsed = JSON.parse(content)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed
      }
      return {}
    } catch {
      return {}
    }
  }

  /** 写入 JSON 文件 */
  private writeFile(config: RuntimeConfig): void {
    const dir = path.dirname(this.configPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
  }
}
