/**
 * Electron 主进程入口
 * 创建窗口、初始化模块、注册 IPC、管理应用生命周期
 */

import { app, BrowserWindow, session, Menu, Tray, nativeImage } from 'electron'
import * as path from 'path'
import { ConfigManager } from './config-manager'
import { BankCache } from './bank-cache'
import { TaskManager } from './task-manager'
import { ProxyCapture } from './proxy-capture'
import { registerIpcHandlers } from './ipc-handlers'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function getAppIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png')
  }
  return path.join(process.cwd(), 'src/renderer/assets/icon.png')
}

function getAppIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(getAppIconPath())
  return icon.isEmpty() ? nativeImage.createEmpty() : icon
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): void {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    resizable: true,
    autoHideMenuBar: true,
    icon: getAppIcon(),
    webPreferences: {
      nodeIntegration: false,
      sandbox: true,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  })

  // 设置 Content-Security-Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
        ],
      },
    })
  })

  // 加载渲染页面
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 关闭窗口时最小化，不退出（任务继续运行）
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.minimize()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createTray(): void {
  tray = new Tray(getAppIcon().resize({ width: 16, height: 16 }))
  updateTrayMenu()

  tray.on('click', () => {
    showMainWindow()
  })

  tray.on('right-click', () => {
    updateTrayMenu()
    tray?.popUpContextMenu()
  })
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function updateTrayMenu(): void {
  if (!tray) return

  const runningTasks = taskManager.getRunningTaskSummaries()
  const taskItems = runningTasks.flatMap((task) => [
    {
      label: truncateText(`▶ ${task.label}`, 36),
      enabled: false,
    },
    {
      label: truncateText(`   ${task.detail}`, 36),
      enabled: false,
    },
    {
      label: truncateText(`   ${task.progress}`, 36),
      enabled: false,
    },
    {
      label: truncateText(`   ${task.lastLog.replace(/^\s+/, '')}`, 46),
      enabled: false,
    },
  ])

  const contextMenu = Menu.buildFromTemplate([
    {
      label: runningTasks.length > 0 ? `正在进行 ${runningTasks.length} 个任务` : '当前没有运行任务',
      enabled: false,
    },
    ...(taskItems.length > 0 ? [{ type: 'separator' as const }, ...taskItems] : []),
    { type: 'separator' },
    {
      label: '显示窗口',
      click: () => {
        showMainWindow()
      },
    },
    {
      label: '刷新任务状态',
      click: () => {
        updateTrayMenu()
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setToolTip(runningTasks.length > 0 ? `词达人助手 - ${runningTasks.length} 个任务运行中` : '词达人助手')
  // Linux 桌面环境通常只支持 setContextMenu，不一定触发 click/right-click 事件。
  tray.setContextMenu(contextMenu)
}

// ── 初始化模块 ──

const userDataPath = app.getPath('userData')

const configManager = new ConfigManager(userDataPath)
const bankCache = new BankCache(path.join(userDataPath, 'bank.json'))
const taskManager = new TaskManager(configManager, bankCache, userDataPath)
const proxyCapture = new ProxyCapture(userDataPath)

taskManager.on('status-changed', () => {
  updateTrayMenu()
})

// 当代理捕获到 token 时，自动保存到配置并停止代理
proxyCapture.on('captured', (tokens: { usertoken: string; abc: string; authV: string }) => {
  configManager.saveConfig({
    USERTOKEN: tokens.usertoken,
    ABC: tokens.abc,
    AUTH_V: tokens.authV,
  })
  proxyCapture.stop()
})

// ── 应用生命周期 ──

app.whenReady().then(() => {
  registerIpcHandlers(configManager, taskManager, () => mainWindow, proxyCapture)
  createTray()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 不退出，保持托盘运行
})

app.on('before-quit', () => {
  isQuitting = true
  taskManager.stopAll()
  if (proxyCapture.isRunning()) {
    proxyCapture.stop()
  }
})
