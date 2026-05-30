/**
 * IPC Handlers - 注册主进程 IPC 通道
 * 连接渲染进程请求与 ConfigManager / TaskManager / ProxyCapture
 */

import { ipcMain, BrowserWindow, shell } from 'electron'
import * as path from 'path'
import type { ConfigManager } from './config-manager'
import type { TaskManager } from './task-manager'
import type { ProxyCapture } from './proxy-capture'
import type { StartTaskPayload, StopTaskPayload, RuntimeConfig } from './types'

/**
 * 注册所有 IPC handlers
 * @param configManager 配置管理器实例
 * @param taskManager 任务管理器实例
 * @param getMainWindow 获取主窗口的函数（可能为 null）
 * @param proxyCapture 代理抓包实例
 */
export function registerIpcHandlers(
  configManager: ConfigManager,
  taskManager: TaskManager,
  getMainWindow: () => BrowserWindow | null,
  proxyCapture?: ProxyCapture
): void {
  // ── 配置相关 ──

  ipcMain.handle('config:get', () => {
    try {
      const config = configManager.getConfig()
      return {
        ok: true,
        config,
        envFile: configManager.getEnvFilePath(),
        missingAuth: configManager.getMissingAuthFields(config),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('config:save', (_event, payload: Partial<RuntimeConfig>) => {
    try {
      const saved = configManager.saveConfig(payload)
      return {
        ok: true,
        config: saved,
        envFile: configManager.getEnvFilePath(),
        missingAuth: configManager.getMissingAuthFields(saved),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ── 任务相关 ──

  ipcMain.handle('llm:test', async () => {
    try {
      const config = configManager.getConfig()
      if (!config.LLM_URL?.trim() || !config.LLM_KEY?.trim()) {
        return { ok: false, error: '请先配置 LLM_URL 和 LLM_KEY' }
      }

      const got = require('got').default || require('got')
      const http = require('http')
      const https = require('https')
      const agent = { http: new http.Agent(), https: new https.Agent() }

      const baseUrl = config.LLM_URL.replace(/\/+$/, '')
      const url = baseUrl.endsWith('/v1')
        ? `${baseUrl}/chat/completions`
        : `${baseUrl}/v1/chat/completions`

      const resp = await got(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.LLM_KEY}`,
        },
        json: {
          model: config.LLM_MODEL || 'step-3.6',
          messages: [
            { role: 'user', content: '请回复"OK"两个字母' },
          ],
          max_tokens: 10,
        },
        timeout: { request: 15000 },
        responseType: 'json',
        agent,
        throwHttpErrors: false,
      })

      const statusCode = resp.statusCode
      const body = resp.body as Record<string, unknown>

      if (statusCode !== 200) {
        const errMsg = (body.error as Record<string, unknown>)?.message || (body.message as string) || JSON.stringify(body).slice(0, 300)
        return { ok: false, error: `HTTP ${statusCode}: ${errMsg}` }
      }

      const choices = body.choices as Array<{ message: { content: string } }> | undefined
      if (choices && choices.length > 0) {
        const reply = choices[0].message.content.trim()
        return { ok: true, reply, model: config.LLM_MODEL }
      }
      return { ok: false, error: `响应异常: ${JSON.stringify(body).slice(0, 200)}` }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('task:list', async () => {
    try {
      const result = await taskManager.listTasks()
      return { ok: true, tasks: result.tasks, warnings: result.warnings }
    } catch (e) {
      // 网络失败时返回本地缓存
      const cached = taskManager.getCachedTasks()
      if (cached.length > 0) {
        return { ok: true, tasks: cached, warnings: [`使用本地缓存: ${e instanceof Error ? e.message : String(e)}`] }
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('task:start', (_event, payload: StartTaskPayload) => {
    try {
      taskManager.startTask(payload)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('task:stop', (_event, payload: StopTaskPayload) => {
    try {
      taskManager.stopTask(payload)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('task:logs', (_event, key: string) => {
    try {
      const result = taskManager.getTaskLogs(key)
      return { ok: true, ...result }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ── 事件推送到渲染进程 ──

  taskManager.on('log', (key: string, message: string) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('task:log', key, message)
    }
  })

  taskManager.on('done', (key: string) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('task:done', key)
    }
  })

  // ── 代理抓包相关 ──

  if (proxyCapture) {
    ipcMain.handle('proxy:start', async () => {
      try {
        await proxyCapture.start()
        return {
          ok: true,
          port: proxyCapture.getPort(),
          caCertPath: proxyCapture.getCaCertPath(),
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    })

    ipcMain.handle('proxy:stop', async () => {
      try {
        await proxyCapture.stop()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    })

    ipcMain.handle('proxy:status', () => {
      return {
        ok: true,
        running: proxyCapture.isRunning(),
        port: proxyCapture.getPort(),
        caCertPath: proxyCapture.getCaCertPath(),
      }
    })

    proxyCapture.on('log', (msg: string) => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('proxy:log', msg)
      }
    })

    proxyCapture.on('captured', (tokens: { usertoken: string; abc: string; authV: string }) => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('proxy:captured', tokens)
      }
    })
  }

  // ── Shell 相关 ──

  ipcMain.handle('shell:openExternal', async (_event, target: string) => {
    const value = String(target || '').trim()
    if (!value) return

    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) {
      await shell.openExternal(value)
      return
    }

    const normalizedPath = path.resolve(value)
    const error = await shell.openPath(normalizedPath)
    if (error) {
      throw new Error(error)
    }
  })
}
