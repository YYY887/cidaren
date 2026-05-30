/**
 * 签名与解密模块
 * 实现 vocabgo API 的请求签名和响应解密逻辑
 */

import { createHash } from 'crypto'
import type { JvRule, Jv3Config } from './types'

export const SALT = 'ajfajfamsnfaflfasakljdlalkflak'

/** JV 解密规则映射表 */
export const JV: Record<string, JvRule[] | Jv3Config> = {
  '2_1254': [
    { s: 0, n: 3 },
    { s: 1, n: 2 },
    { s: 31, n: 1 },
    { s: 41, n: 2 },
    { s: 51, n: 1 },
    { s: 87, n: 1 },
    { s: 97, n: 1 },
  ],
  '2_10234': [
    { s: 0, n: 3 },
    { s: 1, n: 4 },
    { s: 39, n: 1 },
    { s: 57, n: 2 },
    { s: 188, n: 1 },
    { s: 259, n: 1 },
    { s: 316, n: 2 },
  ],
  '2_9214': [
    { s: 0, n: 3 },
    { s: 1, n: 4 },
    { s: 41, n: 2 },
    { s: 57, n: 1 },
    { s: 139, n: 2 },
    { s: 272, n: 1 },
    { s: 361, n: 2 },
  ],
  '2_9314': [
    { s: 0, n: 3 },
    { s: 1, n: 4 },
    { s: 31, n: 2 },
    { s: 60, n: 1 },
    { s: 152, n: 2 },
    { s: 256, n: 1 },
  ],
  '3_1021': {
    uc: [
      { s: 0, n: 1 },
      { s: 1, n: 2 },
      { s: 33, n: 1 },
      { s: 57, n: 1 },
      { s: 111, n: 1 },
    ],
    avg: 5,
    loc: [1, 3, 2, 0, 4],
  },
  '3_2265': {
    uc: [
      { s: 0, n: 2 },
      { s: 1, n: 3 },
      { s: 33, n: 1 },
      { s: 57, n: 1 },
      { s: 121, n: 1 },
    ],
    avg: 5,
    loc: [3, 1, 0, 4, 2],
  },
  '3_2277': {
    uc: [
      { s: 0, n: 3 },
      { s: 1, n: 3 },
      { s: 32, n: 2 },
      { s: 50, n: 1 },
      { s: 110, n: 1 },
    ],
    avg: 5,
    loc: [3, 1, 0, 4, 2],
  },
}

/**
 * 计算 MD5 哈希
 */
function md5(s: string): string {
  return createHash('md5').update(s).digest('hex')
}

/**
 * 对请求参数进行签名
 * 按 key 字母序排序，拼接为 "key=value" 格式，用 "&" 连接后追加盐值取 MD5
 *
 * - 对象/数组值序列化为紧凑 JSON
 * - 空字符串、null、undefined 跳过（但 0 保留）
 */
export function sign(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const key of Object.keys(params).sort()) {
    let v = params[key]
    if (v !== null && v !== undefined && typeof v === 'object') {
      v = JSON.stringify(v)
    }
    // 保留 0，跳过空值
    if (v || v === 0) {
      parts.push(`${key}=${v}`)
    }
  }
  return md5(parts.join('&') + SALT)
}

/**
 * Base64 解码（处理空格和缺失 padding）
 */
export function b64decode(s: string): string {
  let cleaned = s.trim().replace(/ /g, '')
  // 补齐 padding
  const pad = (4 - (cleaned.length % 4)) % 4
  cleaned += '='.repeat(pad)
  return Buffer.from(cleaned, 'base64').toString('utf-8')
}

/**
 * 按规则依次移除字符串中指定位置的字符
 * 每条规则 { s, n } 表示从位置 s 开始移除 n 个字符
 */
export function pluck(data: string, rules: JvRule[]): string {
  let d = data
  for (const { s, n } of rules) {
    d = (s ? d.slice(0, s) : '') + d.slice(s + n)
  }
  return d
}

/**
 * 解密 API 响应
 * 支持 jv=1, 2_*, 3_* 三种解密模式
 * 直接修改并返回传入的响应对象
 */
export function decrypt(resp: Record<string, unknown>): Record<string, unknown> {
  const jv = String(resp.jv ?? '')
  const data = resp.data

  if (!jv || jv === '0' || typeof data !== 'string') return resp

  if (jv === '1') {
    resp.data = JSON.parse(b64decode(data.slice(32)))
  } else if (jv.startsWith('2_') && jv in JV) {
    const rules = JV[jv] as JvRule[]
    resp.data = JSON.parse(b64decode(pluck(data, rules)))
  } else if (jv.startsWith('3_') && jv in JV) {
    const cfg = JV[jv] as Jv3Config
    const d = pluck(data, cfg.uc)
    const avg = cfg.avg
    const loc = cfg.loc
    const chunkSize = Math.floor(d.length / avg)
    const pieces = Array.from({ length: avg }, (_, i) =>
      d.slice(i * chunkSize, (i + 1) * chunkSize)
    )
    let out = ''
    for (let i = 0; i < avg; i++) {
      out += pieces[loc.indexOf(i)]
    }
    if (d.length % chunkSize) {
      out += d.slice(avg * chunkSize)
    }
    resp.data = JSON.parse(b64decode(out))
  }

  return resp
}
