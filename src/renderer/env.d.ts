/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface CidarenAPI {
  getConfig: () => Promise<{
    ok: boolean
    config: import('../main/types').RuntimeConfig
    envFile: string
    missingAuth: string[]
  }>
  testLlm: () => Promise<{ ok: boolean; reply?: string; model?: string; error?: string }>
  saveConfig: (payload: Partial<import('../main/types').RuntimeConfig>) => Promise<{ ok: boolean }>
  getTasks: () => Promise<{
    ok: boolean
    tasks: import('../main/types').TaskInfo[]
    warnings: string[]
  }>
  startTask: (payload: import('../main/types').StartTaskPayload) => Promise<{ ok: boolean }>
  stopTask: (payload: import('../main/types').StopTaskPayload) => Promise<{ ok: boolean }>
  getLogs: (key: import('../main/types').TaskKey) => Promise<{
    logs: string[]
    done: boolean
    exitCode: number | null
  }>
  onTaskLog: (cb: (key: string, msg: string) => void) => void
  onTaskDone: (cb: (key: string) => void) => void

  // 代理抓包
  startProxy: () => Promise<{ ok: boolean; port?: number; caCertPath?: string; error?: string }>
  stopProxy: () => Promise<{ ok: boolean; error?: string }>
  getProxyStatus: () => Promise<{
    ok: boolean
    running: boolean
    port: number
    caCertPath: string
  }>
  onProxyLog: (cb: (msg: string) => void) => void
  onTokensCaptured: (cb: (tokens: { usertoken: string; abc: string; authV: string }) => void) => void

  // Shell
  openExternal: (url: string) => Promise<void>
}

interface Window {
  cidaren: CidarenAPI
}
