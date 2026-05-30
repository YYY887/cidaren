/**
 * utils.ts 单元测试
 */

import { describe, it, expect } from 'vitest'
import {
  norm,
  isCollocation,
  collectWordDefs,
  matchCollocation,
  matchWordToDef,
  matchAnswer,
  sleep
} from '../src/main/utils'
import type { Topic, Option, CollocationRemark } from '../src/main/types'

describe('norm()', () => {
  it('should remove whitespace and lowercase', () => {
    expect(norm('  Hello  World  ')).toBe('helloworld')
  })

  it('should handle empty string', () => {
    expect(norm('')).toBe('')
  })

  it('should handle tabs and newlines', () => {
    expect(norm('A\tB\nC')).toBe('abc')
  })
})

describe('sleep()', () => {
  it('should resolve after a delay within range', async () => {
    const start = Date.now()
    await sleep(0.01, 0.02)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(9)
    expect(elapsed).toBeLessThan(100)
  })
})

describe('isCollocation()', () => {
  it('should return true for mode=31 with remark array containing relation', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: [{ relation: 'take off' }] as CollocationRemark[] },
      options: []
    }
    expect(isCollocation(topic)).toBe(true)
  })

  it('should return false for mode != 31', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 0,
      stem: { content: 'word', remark: [{ relation: 'rel' }] as CollocationRemark[] },
      options: []
    }
    expect(isCollocation(topic)).toBe(false)
  })

  it('should return false when remark is a string', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: 'just a string' },
      options: []
    }
    expect(isCollocation(topic)).toBe(false)
  })

  it('should return false when remark is empty array', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: [] as unknown as CollocationRemark[] },
      options: []
    }
    expect(isCollocation(topic)).toBe(false)
  })

  it('should return false when first element has no relation', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: [{ other: 'value' }] as unknown as CollocationRemark[] },
      options: []
    }
    expect(isCollocation(topic)).toBe(false)
  })
})

describe('collectWordDefs()', () => {
  it('should collect option contents for mode=0 topics', () => {
    const wordDefs = new Map<string, string[]>()
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 0,
      stem: { content: 'abandon', remark: '' },
      options: [
        { content: 'v. 放弃', answer_tag: 0 },
        { content: 'n. 遗弃', answer_tag: 1 }
      ]
    }
    collectWordDefs(topic, wordDefs)
    expect(wordDefs.get('abandon')).toEqual(['v. 放弃', 'n. 遗弃'])
  })

  it('should not collect for non-mode-0 topics', () => {
    const wordDefs = new Map<string, string[]>()
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: '' },
      options: [{ content: 'def', answer_tag: 0 }]
    }
    collectWordDefs(topic, wordDefs)
    expect(wordDefs.size).toBe(0)
  })

  it('should normalize stem word (lowercase, no spaces)', () => {
    const wordDefs = new Map<string, string[]>()
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 0,
      stem: { content: '  Hello  ', remark: '' },
      options: [{ content: 'greeting', answer_tag: 0 }]
    }
    collectWordDefs(topic, wordDefs)
    expect(wordDefs.has('hello')).toBe(true)
  })

  it('should skip empty content options', () => {
    const wordDefs = new Map<string, string[]>()
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 0,
      stem: { content: 'word', remark: '' },
      options: [
        { content: '', answer_tag: 0 },
        { content: 'valid', answer_tag: 1 }
      ]
    }
    collectWordDefs(topic, wordDefs)
    expect(wordDefs.get('word')).toEqual(['valid'])
  })
})

describe('matchCollocation()', () => {
  it('should match options whose content matches a relation', () => {
    const remark: CollocationRemark[] = [
      { relation: 'take off' },
      { relation: 'put on' }
    ]
    const opts: Option[] = [
      { content: 'take off', answer_tag: 0 },
      { content: 'give up', answer_tag: 1 },
      { content: 'put on', answer_tag: 2 }
    ]
    expect(matchCollocation(remark, opts)).toEqual([0, 2])
  })

  it('should be case-insensitive', () => {
    const remark: CollocationRemark[] = [{ relation: 'Take Off' }]
    const opts: Option[] = [
      { content: 'TAKE OFF', answer_tag: 0 },
      { content: 'other', answer_tag: 1 }
    ]
    expect(matchCollocation(remark, opts)).toEqual([0])
  })

  it('should return null when no relations found', () => {
    const remark: CollocationRemark[] = [{ relation: '' }]
    const opts: Option[] = [{ content: 'something', answer_tag: 0 }]
    expect(matchCollocation(remark, opts)).toBeNull()
  })

  it('should return null when no options match', () => {
    const remark: CollocationRemark[] = [{ relation: 'unique' }]
    const opts: Option[] = [{ content: 'other', answer_tag: 0 }]
    expect(matchCollocation(remark, opts)).toBeNull()
  })

  it('should return null for non-array input', () => {
    expect(matchCollocation(null as any, [])).toBeNull()
  })
})

describe('matchWordToDef()', () => {
  it('should match exact word in wordDefs', () => {
    const wordDefs = new Map([['hello', ['n. 问候']]])
    const opts: Option[] = [
      { content: 'n. 问候', answer_tag: 0 },
      { content: 'v. 跑步', answer_tag: 1 }
    ]
    expect(matchWordToDef('hello', opts, wordDefs)).toBe(0)
  })

  it('should match via prefix (target starts with key)', () => {
    const wordDefs = new Map([['abandon', ['v. 放弃']]])
    const opts: Option[] = [
      { content: 'v. 放弃', answer_tag: 0 },
      { content: 'n. 其他', answer_tag: 1 }
    ]
    expect(matchWordToDef('abandonment', opts, wordDefs)).toBe(0)
  })

  it('should match via prefix (key starts with target)', () => {
    const wordDefs = new Map([['abandonment', ['n. 遗弃']]])
    const opts: Option[] = [
      { content: 'n. 遗弃', answer_tag: 0 },
      { content: 'v. 其他', answer_tag: 1 }
    ]
    expect(matchWordToDef('abandon', opts, wordDefs)).toBe(0)
  })

  it('should return null when no defs found', () => {
    const wordDefs = new Map<string, string[]>()
    const opts: Option[] = [{ content: 'def', answer_tag: 0 }]
    expect(matchWordToDef('unknown', opts, wordDefs)).toBeNull()
  })

  it('should match via keyword splitting', () => {
    const wordDefs = new Map([['word', ['n. 放弃；遗弃']]])
    const opts: Option[] = [
      { content: '包含遗弃的选项', answer_tag: 0 },
      { content: '无关选项', answer_tag: 1 }
    ]
    expect(matchWordToDef('word', opts, wordDefs)).toBe(0)
  })

  it('should match via normalized containment', () => {
    const wordDefs = new Map([['test', ['放弃希望']]])
    const opts: Option[] = [
      { content: '放弃 希望', answer_tag: 0 },
      { content: '其他', answer_tag: 1 }
    ]
    // norm('放弃 希望') = '放弃希望', norm('放弃希望') = '放弃希望' → equal
    expect(matchWordToDef('test', opts, wordDefs)).toBe(0)
  })
})

describe('matchAnswer()', () => {
  it('should route collocation topics to matchCollocation', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'word', remark: [{ relation: 'take off' }] as CollocationRemark[] },
      options: [
        { content: 'take off', answer_tag: 0 },
        { content: 'other', answer_tag: 1 }
      ]
    }
    expect(matchAnswer(topic, new Map())).toEqual([0])
  })

  it('should return null for mode=32', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 32,
      stem: { content: '_ _ _', remark: '放弃' },
      options: [{ content: 'give', answer_tag: 0 }]
    }
    expect(matchAnswer(topic, new Map())).toBeNull()
  })

  it('should return null for mode=11', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 11,
      stem: { content: 'The {word} is good', remark: '这个词很好' },
      options: [{ content: 'def', answer_tag: 0 }]
    }
    expect(matchAnswer(topic, new Map())).toBeNull()
  })

  it('should use matchWordToDef for mode=31 non-collocation', () => {
    const wordDefs = new Map([['hello', ['n. 问候']]])
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: 'hello', remark: '' },
      options: [
        { content: 'n. 问候', answer_tag: 0 },
        { content: 'v. 跑步', answer_tag: 1 }
      ]
    }
    expect(matchAnswer(topic, wordDefs)).toBe(0)
  })

  it('should return null for mode=0', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 0,
      stem: { content: 'word', remark: '' },
      options: [{ content: 'def', answer_tag: 0 }]
    }
    expect(matchAnswer(topic, new Map())).toBeNull()
  })

  it('should return null when stem starts with underscore', () => {
    const topic: Topic = {
      topic_code: 'TC',
      topic_mode: 31,
      stem: { content: '_ blank', remark: '' },
      options: [{ content: 'def', answer_tag: 0 }]
    }
    expect(matchAnswer(topic, new Map())).toBeNull()
  })
})
