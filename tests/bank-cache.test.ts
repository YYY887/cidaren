/**
 * BankCache 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { BankCache, topicKey } from '../src/main/bank-cache'
import type { Topic, BankEntry } from '../src/main/types'

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bank-cache-test-'))
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

describe('BankCache', () => {
  let tmpDir: string
  let bankPath: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
    bankPath = path.join(tmpDir, 'bank.json')
  })

  afterEach(() => {
    cleanup(tmpDir)
  })

  describe('load()', () => {
    it('should return empty object when file does not exist', () => {
      const cache = new BankCache(bankPath)
      expect(cache.size).toBe(0)
    })

    it('should load valid bank.json', () => {
      const data = { 'key1': { ans: 1, stem: 'hello' } }
      fs.writeFileSync(bankPath, JSON.stringify(data), 'utf-8')
      const cache = new BankCache(bankPath)
      expect(cache.size).toBe(1)
      expect(cache.get('key1')).toEqual({ ans: 1, stem: 'hello' })
    })

    it('should return empty object when file is corrupted', () => {
      fs.writeFileSync(bankPath, 'not valid json{{{', 'utf-8')
      const cache = new BankCache(bankPath)
      expect(cache.size).toBe(0)
    })

    it('should return empty object when file contains an array', () => {
      fs.writeFileSync(bankPath, '[1,2,3]', 'utf-8')
      const cache = new BankCache(bankPath)
      expect(cache.size).toBe(0)
    })
  })

  describe('save()', () => {
    it('should persist data to file atomically', () => {
      const cache = new BankCache(bankPath)
      cache.set('k1', { ans: 2, stem: 'world' })
      cache.save()

      const content = JSON.parse(fs.readFileSync(bankPath, 'utf-8'))
      expect(content).toEqual({ k1: { ans: 2, stem: 'world' } })
    })

    it('should create directory if it does not exist', () => {
      const deepPath = path.join(tmpDir, 'sub', 'dir', 'bank.json')
      const cache = new BankCache(deepPath)
      cache.set('k', { ans: 0, stem: 'test' })
      cache.save()

      expect(fs.existsSync(deepPath)).toBe(true)
    })

    it('should accept explicit bank data to save', () => {
      const cache = new BankCache(bankPath)
      const explicit = { 'explicit': { ans: 3, stem: 'explicit' } }
      cache.save(explicit)

      const content = JSON.parse(fs.readFileSync(bankPath, 'utf-8'))
      expect(content).toEqual(explicit)
    })
  })

  describe('get() / set()', () => {
    it('should read and write entries in memory', () => {
      const cache = new BankCache(bankPath)
      expect(cache.get('missing')).toBeUndefined()

      cache.set('key', { ans: [1, 2], stem: 'multi' })
      expect(cache.get('key')).toEqual({ ans: [1, 2], stem: 'multi' })
    })
  })

  describe('size', () => {
    it('should reflect number of entries', () => {
      const cache = new BankCache(bankPath)
      expect(cache.size).toBe(0)
      cache.set('a', { ans: 0, stem: 'a' })
      cache.set('b', { ans: 1, stem: 'b' })
      expect(cache.size).toBe(2)
    })
  })
})

describe('topicKey()', () => {
  it('should generate deterministic key for same topic', () => {
    const topic: Topic = {
      topic_code: 'TC001',
      topic_mode: 31,
      stem: { content: 'Hello World', remark: 'some remark' },
      options: [
        { content: 'opt1', answer_tag: 0 },
        { content: 'opt2', answer_tag: 1 }
      ]
    }
    const k1 = topicKey(topic)
    const k2 = topicKey(topic)
    expect(k1).toBe(k2)
  })

  it('should normalize stem whitespace', () => {
    const t1: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: '  hello   world  ', remark: '' },
      options: []
    }
    const t2: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'hello world', remark: '' },
      options: []
    }
    expect(topicKey(t1)).toBe(topicKey(t2))
  })

  it('should include mode in key', () => {
    const base: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: '' },
      options: [{ content: 'def', answer_tag: 0 }]
    }
    const other: Topic = { ...base, topic_mode: 11 }
    expect(topicKey(base)).not.toBe(topicKey(other))
  })

  it('should mark collocation topics as "coll"', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: [{ relation: 'take off' }] as CollocationRemark[] },
      options: [{ content: 'take off', answer_tag: 0 }]
    }
    expect(topicKey(topic)).toContain('::coll::')
  })

  it('should mark non-collocation topics as "norm"', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: 'just a string' },
      options: [{ content: 'def', answer_tag: 0 }]
    }
    expect(topicKey(topic)).toContain('::norm::')
  })

  it('should serialize array remark as JSON', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: [{ relation: 'rel' }] as CollocationRemark[] },
      options: []
    }
    const key = topicKey(topic)
    expect(key).toContain('[{"relation":"rel"}]')
  })

  it('should truncate option content to 20 chars', () => {
    const longContent = 'a'.repeat(30)
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: '' },
      options: [{ content: longContent, answer_tag: 0 }]
    }
    const key = topicKey(topic)
    // The options part should only have 20 chars
    expect(key).toContain('a'.repeat(20))
    expect(key).not.toContain('a'.repeat(21))
  })
})
