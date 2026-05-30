import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  ConfigManager,
  DEFAULT_CONFIG,
  REQUIRED_AUTH_FIELDS,
  CONFIG_FIELDS,
  parseEnvValue,
  formatEnvValue,
  parseEnvContent
} from '../src/main/config-manager'

describe('parseEnvValue', () => {
  it('returns empty string for empty input', () => {
    expect(parseEnvValue('')).toBe('')
    expect(parseEnvValue('   ')).toBe('')
  })

  it('strips whitespace from unquoted values', () => {
    expect(parseEnvValue('  hello  ')).toBe('hello')
  })

  it('handles double-quoted values with JSON escapes', () => {
    expect(parseEnvValue('"hello world"')).toBe('hello world')
    expect(parseEnvValue('"line\\nbreak"')).toBe('line\nbreak')
    expect(parseEnvValue('"with \\"quotes\\""')).toBe('with "quotes"')
  })

  it('handles single-quoted values', () => {
    expect(parseEnvValue("'hello world'")).toBe('hello world')
    expect(parseEnvValue("'no \\n escape'")).toBe('no \\n escape')
  })

  it('handles malformed double quotes gracefully', () => {
    // If JSON.parse fails, falls back to stripping quotes
    // e.g. "bad json content" where the inner content isn't valid JSON
    expect(parseEnvValue('"bad \\x json"')).toBe('bad \\x json')
  })

  it('returns plain values as-is', () => {
    expect(parseEnvValue('simple')).toBe('simple')
    expect(parseEnvValue('https://example.com/v1')).toBe('https://example.com/v1')
  })
})

describe('formatEnvValue', () => {
  it('wraps empty string in double quotes', () => {
    expect(formatEnvValue('')).toBe('""')
    expect(formatEnvValue(null)).toBe('""')
    expect(formatEnvValue(undefined)).toBe('""')
  })

  it('quotes values with spaces', () => {
    expect(formatEnvValue('hello world')).toBe('"hello world"')
  })

  it('quotes values with special characters', () => {
    expect(formatEnvValue('has#hash')).toBe('"has#hash"')
    expect(formatEnvValue('has"quote')).toBe('"has\\"quote"')
    expect(formatEnvValue('has\\backslash')).toBe('"has\\\\backslash"')
  })

  it('returns plain values without quotes', () => {
    expect(formatEnvValue('simple')).toBe('simple')
    expect(formatEnvValue('https://example.com')).toBe('https://example.com')
  })
})

describe('parseEnvContent', () => {
  it('parses key=value pairs', () => {
    const content = 'FOO=bar\nBAZ=qux'
    expect(parseEnvContent(content)).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('skips empty lines and comments', () => {
    const content = '# comment\n\nFOO=bar\n  # another comment\nBAZ=qux'
    expect(parseEnvContent(content)).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('skips lines without =', () => {
    const content = 'FOO=bar\ninvalid line\nBAZ=qux'
    expect(parseEnvContent(content)).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('handles export prefix', () => {
    const content = 'export FOO=bar\nexport BAZ=qux'
    expect(parseEnvContent(content)).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('handles values with = sign', () => {
    const content = 'URL=https://example.com?a=1&b=2'
    expect(parseEnvContent(content)).toEqual({ URL: 'https://example.com?a=1&b=2' })
  })

  it('handles quoted values', () => {
    const content = 'FOO="hello world"\nBAR=\'single quoted\''
    expect(parseEnvContent(content)).toEqual({ FOO: 'hello world', BAR: 'single quoted' })
  })
})

describe('ConfigManager', () => {
  let tmpDir: string
  let manager: ConfigManager

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'))
    manager = new ConfigManager(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('getEnvFilePath', () => {
    it('returns the correct .env file path', () => {
      expect(manager.getEnvFilePath()).toBe(path.join(tmpDir, '.env'))
    })

    it('supports custom env file name', () => {
      const custom = new ConfigManager(tmpDir, '.env.local')
      expect(custom.getEnvFilePath()).toBe(path.join(tmpDir, '.env.local'))
    })
  })

  describe('getConfig', () => {
    it('returns default config when .env does not exist', () => {
      const config = manager.getConfig()
      expect(config).toEqual(DEFAULT_CONFIG)
    })

    it('merges .env values with defaults', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'USERTOKEN=mytoken\nLLM_URL=https://custom.api/v1\n',
        'utf-8'
      )
      const config = manager.getConfig()
      expect(config.USERTOKEN).toBe('mytoken')
      expect(config.LLM_URL).toBe('https://custom.api/v1')
      // Defaults preserved for unset fields
      expect(config.LLM_MODEL).toBe('step-3.6')
      expect(config.COURSE_ID).toBe('CET4_v2')
    })

    it('handles corrupted .env file gracefully', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), '\x00\x01\x02', 'utf-8')
      const config = manager.getConfig()
      expect(config).toEqual(DEFAULT_CONFIG)
    })
  })

  describe('saveConfig', () => {
    it('saves config and returns merged result', () => {
      const result = manager.saveConfig({ USERTOKEN: 'tok123', ABC: 'abc456' })
      expect(result.USERTOKEN).toBe('tok123')
      expect(result.ABC).toBe('abc456')
      // Defaults preserved
      expect(result.LLM_URL).toBe('https://ai.saurlax.com/v1')
    })

    it('persists config to .env file', () => {
      manager.saveConfig({ USERTOKEN: 'tok123' })
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8')
      expect(content).toContain('USERTOKEN=tok123')
    })

    it('round-trips config correctly', () => {
      const payload = {
        USERTOKEN: 'my-token',
        ABC: 'abc-value',
        AUTH_V: 'v1',
        LLM_URL: 'https://custom.api/v1',
        LLM_KEY: 'sk-key123',
        LLM_MODEL: 'gpt-4',
        COURSE_ID: 'CET6_v1',
        STUDY_GRADE: '3'
      }
      manager.saveConfig(payload)
      const loaded = manager.getConfig()
      expect(loaded).toEqual(payload)
    })

    it('handles values with spaces and special characters', () => {
      manager.saveConfig({ USERTOKEN: 'has space', ABC: 'has#hash' })
      const loaded = manager.getConfig()
      expect(loaded.USERTOKEN).toBe('has space')
      expect(loaded.ABC).toBe('has#hash')
    })

    it('handles empty string values', () => {
      manager.saveConfig({ USERTOKEN: '', LLM_KEY: '' })
      const loaded = manager.getConfig()
      expect(loaded.USERTOKEN).toBe('')
      expect(loaded.LLM_KEY).toBe('')
    })

    it('trims whitespace from payload values', () => {
      manager.saveConfig({ USERTOKEN: '  trimmed  ' })
      const loaded = manager.getConfig()
      expect(loaded.USERTOKEN).toBe('trimmed')
    })

    it('handles null values as empty string', () => {
      manager.saveConfig({ USERTOKEN: null as unknown as string })
      const loaded = manager.getConfig()
      expect(loaded.USERTOKEN).toBe('')
    })
  })

  describe('getMissingAuthFields', () => {
    it('returns all auth fields when config is default', () => {
      const missing = manager.getMissingAuthFields()
      expect(missing).toEqual(['USERTOKEN', 'ABC', 'AUTH_V'])
    })

    it('returns empty array when all auth fields are set', () => {
      manager.saveConfig({ USERTOKEN: 'tok', ABC: 'abc', AUTH_V: 'v1' })
      const missing = manager.getMissingAuthFields()
      expect(missing).toEqual([])
    })

    it('returns only the missing fields', () => {
      manager.saveConfig({ USERTOKEN: 'tok', ABC: '', AUTH_V: 'v1' })
      const missing = manager.getMissingAuthFields()
      expect(missing).toEqual(['ABC'])
    })

    it('treats whitespace-only values as missing', () => {
      manager.saveConfig({ USERTOKEN: '   ', ABC: 'abc', AUTH_V: 'v1' })
      const missing = manager.getMissingAuthFields()
      expect(missing).toEqual(['USERTOKEN'])
    })

    it('accepts an explicit config parameter', () => {
      const config = { ...DEFAULT_CONFIG, USERTOKEN: 'tok', ABC: 'abc', AUTH_V: '' }
      const missing = manager.getMissingAuthFields(config)
      expect(missing).toEqual(['AUTH_V'])
    })
  })
})
