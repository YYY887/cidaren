import { describe, it, expect } from 'vitest'
import { sign, decrypt, pluck, b64decode, SALT, JV } from '../src/main/crypto'

describe('sign', () => {
  it('should produce correct MD5 for simple params', () => {
    // sign({a: "1", b: "2"}) => md5("a=1&b=2" + SALT)
    const result = sign({ a: '1', b: '2' })
    expect(result).toHaveLength(32)
    expect(result).toMatch(/^[0-9a-f]{32}$/)
  })

  it('should sort keys alphabetically', () => {
    const r1 = sign({ b: '2', a: '1' })
    const r2 = sign({ a: '1', b: '2' })
    expect(r1).toBe(r2)
  })

  it('should serialize objects as compact JSON', () => {
    const r1 = sign({ data: { x: 1, y: 2 } })
    // The object should be serialized as {"x":1,"y":2}
    const r2 = sign({ data: '{"x":1,"y":2}' })
    expect(r1).toBe(r2)
  })

  it('should serialize arrays as compact JSON', () => {
    const r1 = sign({ items: [1, 2, 3] })
    const r2 = sign({ items: '[1,2,3]' })
    expect(r1).toBe(r2)
  })

  it('should skip empty string values', () => {
    const r1 = sign({ a: '1', b: '' })
    const r2 = sign({ a: '1' })
    expect(r1).toBe(r2)
  })

  it('should skip null and undefined values', () => {
    const r1 = sign({ a: '1', b: null, c: undefined })
    const r2 = sign({ a: '1' })
    expect(r1).toBe(r2)
  })

  it('should keep 0 as a valid value', () => {
    const r1 = sign({ a: '1', b: 0 })
    const r2 = sign({ a: '1' })
    expect(r1).not.toBe(r2)
  })

  it('should produce same output as Python for known input', () => {
    // Python: _sign({"timestamp": "1700000000", "app_type": "1"})
    // sorted keys: app_type, timestamp
    // parts: "app_type=1&timestamp=1700000000"
    // md5("app_type=1&timestamp=1700000000" + SALT)
    const result = sign({ timestamp: '1700000000', app_type: '1' })
    // We can verify the algorithm manually:
    // "app_type=1&timestamp=1700000000ajfajfamsnfaflfasakljdlalkflak"
    const crypto = require('crypto')
    const expected = crypto
      .createHash('md5')
      .update('app_type=1&timestamp=1700000000' + SALT)
      .digest('hex')
    expect(result).toBe(expected)
  })

  it('should handle Chinese characters in values', () => {
    const result = sign({ word: '你好' })
    expect(result).toHaveLength(32)
    expect(result).toMatch(/^[0-9a-f]{32}$/)
  })

  it('should handle numeric values correctly', () => {
    // Numbers should be converted to string
    const r1 = sign({ page: 1, size: 10 })
    const r2 = sign({ page: '1', size: '10' })
    expect(r1).toBe(r2)
  })
})

describe('b64decode', () => {
  it('should decode standard base64', () => {
    // "hello" in base64 is "aGVsbG8="
    expect(b64decode('aGVsbG8=')).toBe('hello')
  })

  it('should handle missing padding', () => {
    // "hello" without padding: "aGVsbG8"
    expect(b64decode('aGVsbG8')).toBe('hello')
  })

  it('should handle spaces in input', () => {
    expect(b64decode('aGVs bG8=')).toBe('hello')
  })

  it('should handle leading/trailing whitespace', () => {
    expect(b64decode('  aGVsbG8=  ')).toBe('hello')
  })

  it('should decode JSON content', () => {
    // {"code":1} => eyJjb2RlIjoxfQ==
    expect(b64decode('eyJjb2RlIjoxfQ==')).toBe('{"code":1}')
  })
})

describe('pluck', () => {
  it('should remove characters at specified positions', () => {
    // "abcdefgh", rule {s:0, n:3} => remove first 3 chars => "defgh"
    expect(pluck('abcdefgh', [{ s: 0, n: 3 }])).toBe('defgh')
  })

  it('should handle s=0 correctly (remove from start)', () => {
    expect(pluck('hello', [{ s: 0, n: 2 }])).toBe('llo')
  })

  it('should handle multiple rules sequentially', () => {
    // "abcdefgh"
    // rule 1: {s:0, n:2} => "cdefgh"
    // rule 2: {s:1, n:1} => "c" + "efgh" = "cefgh"
    expect(pluck('abcdefgh', [{ s: 0, n: 2 }, { s: 1, n: 1 }])).toBe('cefgh')
  })

  it('should return original string for empty rules', () => {
    expect(pluck('hello', [])).toBe('hello')
  })

  it('should reduce length by sum of all n values', () => {
    const input = 'a'.repeat(100)
    const rules = [{ s: 0, n: 3 }, { s: 1, n: 2 }, { s: 5, n: 4 }]
    const totalRemoved = rules.reduce((sum, r) => sum + r.n, 0)
    expect(pluck(input, rules).length).toBe(input.length - totalRemoved)
  })
})

describe('decrypt', () => {
  it('should return resp unchanged when jv is empty', () => {
    const resp = { code: 1, data: { foo: 'bar' }, jv: '' }
    expect(decrypt(resp)).toBe(resp)
    expect(resp.data).toEqual({ foo: 'bar' })
  })

  it('should return resp unchanged when jv is "0"', () => {
    const resp = { code: 1, data: 'something', jv: '0' }
    expect(decrypt(resp)).toBe(resp)
    expect(resp.data).toBe('something')
  })

  it('should return resp unchanged when data is not a string', () => {
    const resp = { code: 1, data: { foo: 'bar' }, jv: '1' }
    expect(decrypt(resp)).toBe(resp)
    expect(resp.data).toEqual({ foo: 'bar' })
  })

  it('should return resp unchanged when jv is undefined', () => {
    const resp = { code: 1, data: 'something' }
    expect(decrypt(resp)).toBe(resp)
  })

  it('should decrypt jv=1 by skipping first 32 chars and base64 decoding', () => {
    // Create test data: 32 random chars + base64 encoded JSON
    const jsonData = { result: 'success' }
    const b64 = Buffer.from(JSON.stringify(jsonData)).toString('base64')
    const data = 'a'.repeat(32) + b64

    const resp = { code: 1, data, jv: '1' }
    decrypt(resp)
    expect(resp.data).toEqual(jsonData)
  })

  it('should decrypt jv=2_* by plucking then base64 decoding', () => {
    // We need to construct data that after plucking with 2_1254 rules
    // produces a valid base64 string
    const jsonData = { test: 'value' }
    const b64 = Buffer.from(JSON.stringify(jsonData)).toString('base64')

    // Insert garbage chars at positions that will be plucked
    // Rules for 2_1254: [{s:0,n:3},{s:1,n:2},{s:31,n:1},{s:41,n:2},{s:51,n:1},{s:87,n:1},{s:97,n:1}]
    // We need to reverse-engineer: insert chars at positions so pluck removes them
    // Easier approach: build a string, apply pluck, verify it matches b64
    // Then prepend the garbage to create the encrypted version

    // Let's use a simpler approach: manually construct and verify
    const rules = JV['2_1254'] as { s: number; n: number }[]

    // Build the encrypted string by inserting garbage at pluck positions (in reverse)
    let encrypted = b64
    // Apply rules in reverse to insert chars
    for (let i = rules.length - 1; i >= 0; i--) {
      const { s, n } = rules[i]
      const garbage = 'X'.repeat(n)
      encrypted = encrypted.slice(0, s) + garbage + encrypted.slice(s)
    }

    const resp = { code: 1, data: encrypted, jv: '2_1254' }
    decrypt(resp)
    expect(resp.data).toEqual(jsonData)
  })

  it('should decrypt jv=3_* by plucking, chunking, reordering, then base64 decoding', () => {
    // For 3_1021: uc rules, avg=5, loc=[1,3,2,0,4]
    // The loc array means: piece at index loc.indexOf(0)=3 goes first,
    // loc.indexOf(1)=0 goes second, loc.indexOf(2)=2 goes third, etc.
    // Actually: out = pieces[loc.indexOf(i)] for i in range(avg)
    // loc = [1,3,2,0,4]
    // loc.indexOf(0) = 3 → pieces[3]
    // loc.indexOf(1) = 0 → pieces[0]
    // loc.indexOf(2) = 2 → pieces[2]
    // loc.indexOf(3) = 1 → pieces[1]
    // loc.indexOf(4) = 4 → pieces[4]
    // So out = pieces[3] + pieces[0] + pieces[2] + pieces[1] + pieces[4]

    const jsonData = { hello: 'world' }
    const b64 = Buffer.from(JSON.stringify(jsonData)).toString('base64')

    // We need to create data that after pluck + chunk + reorder = b64
    // First, figure out the reordering: we need to reverse it
    const cfg = JV['3_1021'] as { uc: { s: number; n: number }[]; avg: number; loc: number[] }
    const avg = cfg.avg
    const loc = cfg.loc

    // Pad b64 to be divisible by avg for simplicity
    let target = b64
    while (target.length % avg !== 0) {
      target += '='
    }

    const chunkSize = Math.floor(target.length / avg)

    // out = pieces[loc.indexOf(0)] + pieces[loc.indexOf(1)] + ... + pieces[loc.indexOf(avg-1)]
    // So target chunk i = pieces[loc.indexOf(i)]
    // We need to find pieces such that pieces[loc.indexOf(i)] = target.slice(i*chunk, (i+1)*chunk)
    // pieces[j] = target.slice(loc[j]*chunk, (loc[j]+1)*chunk)
    // Wait, let me think again...
    // out[i*chunk..(i+1)*chunk] = pieces[loc.indexOf(i)]
    // So pieces[loc.indexOf(i)] = target[i*chunk..(i+1)*chunk]
    // Let idx = loc.indexOf(i), then pieces[idx] = target[i*chunk..(i+1)*chunk]

    const pieces: string[] = new Array(avg)
    for (let i = 0; i < avg; i++) {
      const idx = loc.indexOf(i)
      pieces[idx] = target.slice(i * chunkSize, (i + 1) * chunkSize)
    }

    // d (after pluck) = pieces[0] + pieces[1] + ... + pieces[avg-1]
    const d = pieces.join('')

    // Now reverse the pluck: insert garbage chars
    let encrypted = d
    for (let i = cfg.uc.length - 1; i >= 0; i--) {
      const { s, n } = cfg.uc[i]
      const garbage = 'Y'.repeat(n)
      encrypted = encrypted.slice(0, s) + garbage + encrypted.slice(s)
    }

    const resp = { code: 1, data: encrypted, jv: '3_1021' }
    decrypt(resp)
    expect(resp.data).toEqual(jsonData)
  })

  it('should handle unknown jv version gracefully', () => {
    const resp = { code: 1, data: 'somedata', jv: '99_unknown' }
    decrypt(resp)
    expect(resp.data).toBe('somedata')
  })

  it('should mutate and return the same response object', () => {
    const jsonData = { x: 1 }
    const b64 = Buffer.from(JSON.stringify(jsonData)).toString('base64')
    const data = 'a'.repeat(32) + b64
    const resp = { code: 1, data, jv: '1' }
    const returned = decrypt(resp)
    expect(returned).toBe(resp)
  })
})
