/**
 * Preload 脚本
 * 通过 contextBridge 暴露安全的 IPC API 给渲染进程
 * 渲染进程通过 window.cidaren.* 调用
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('cidaren', {
  /** 获取运行时配置 */
  getConfig: () => ipcRenderer.invoke('config:get'),

  /** 保存配置 */
  saveConfig: (payload: Record<string, string>) => ipcRenderer.invoke('config:save', payload),

  /** 测试 LLM 连接 */
  testLlm: () => ipcRenderer.invoke('llm:test'),

  /** 获取任务列表 */
  getTasks: () => ipcRenderer.invoke('task:list'),

  /** 启动任务 */
  startTask: (payload: Record<string, unknown>) => ipcRenderer.invoke('task:start', payload),

  /** 停止任务 */
  stopTask: (payload: Record<string, unknown>) => ipcRenderer.invoke('task:stop', payload),

  /** 获取任务日志 */
  getLogs: (key: string) => ipcRenderer.invoke('task:logs', key),

  /** 监听任务日志推送 */
  onTaskLog: (cb: (key: string, msg: string) => void) => {
    ipcRenderer.on('task:log', (_event, key, msg) => cb(key, msg))
  },

  /** 监听任务完成推送 */
  onTaskDone: (cb: (key: string) => void) => {
    ipcRenderer.on('task:done', (_event, key) => cb(key))
  },

  // ── 代理抓包 ──

  /** 启动代理 */
  startProxy: () => ipcRenderer.invoke('proxy:start'),

  /** 停止代理 */
  stopProxy: () => ipcRenderer.invoke('proxy:stop'),

  /** 获取代理状态 */
  getProxyStatus: () => ipcRenderer.invoke('proxy:status'),

  /** 监听代理日志 */
  onProxyLog: (cb: (msg: string) => void) => {
    ipcRenderer.on('proxy:log', (_event, msg) => cb(msg))
  },

  /** 监听 token 捕获事件 */
  onTokensCaptured: (cb: (tokens: { usertoken: string; abc: string; authV: string }) => void) => {
    ipcRenderer.on('proxy:captured', (_event, tokens) => cb(tokens))
  },

  // ── Shell ──

  /** 在默认浏览器中打开 URL */
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
})
