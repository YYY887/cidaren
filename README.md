# 词达人助手

词达人助手是一个基于 **Electron + Vue 3 + TypeScript + Vite** 开发的桌面应用，用于辅助管理词达人学习任务。应用提供图形化界面，可完成鉴权信息抓取、任务列表读取、任务执行、题库缓存、LLM 辅助判断、运行日志查看等功能。

> 注意：本项目涉及第三方平台接口、账号鉴权信息和本地代理抓包功能。请仅在你拥有合法使用权限的账号和环境中使用，并自行遵守相关平台规则。

## 项目截图

> 截图文件位于 `img/` 目录。

![项目截图 1](img/1.png)

![项目截图 2](img/2.png)

![项目截图 3](img/3.png)

![项目截图 4](img/4.png)

## 功能特性

- Electron 桌面端应用，支持窗口和系统托盘运行。
- Vue 3 + Element Plus 前端界面。
- 本地代理抓包获取词达人鉴权信息：
  - `USERTOKEN`
  - `ABC`
  - `AUTH_V`
- 支持配置模型 API：
  - 自定义 OpenAI 兼容 API
  - 轨迹流动 API 快捷配置
- 支持 LLM 辅助答题，并内置限速等待逻辑。
- LLM 限速时暂停等待，不盲猜提交。
- 支持班级任务和自学任务。
- 支持任务运行日志、任务进度和托盘状态展示。
- 支持本地题库缓存。
- 支持成功提示音和点击音效。
- 支持 Windows / Linux 打包配置。

## 技术栈

- Electron `28.2.1`
- Vue `3.4.x`
- TypeScript
- Vite
- Element Plus
- electron-builder
- got
- node-forge
- Vitest

## 项目结构

```text
cidaren-electron/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.ts          # 主入口、窗口、托盘、生命周期
│   │   ├── ipc-handlers.ts   # IPC 通道
│   │   ├── task-manager.ts   # 任务管理
│   │   ├── quiz-engine.ts    # 答题引擎
│   │   ├── vocabgo-client.ts # 词达人接口客户端
│   │   ├── proxy-capture.ts  # 本地代理抓包
│   │   ├── config-manager.ts # 配置管理
│   │   ├── bank-cache.ts     # 题库缓存
│   │   ├── llm-client.ts     # LLM 接口客户端
│   │   └── types.ts          # 类型定义
│   ├── preload/              # Electron preload
│   └── renderer/             # Vue 渲染端
│       ├── App.vue
│       ├── main.ts
│       ├── sound-effects.ts
│       ├── assets/           # 图标和音效资源
│       └── components/
├── tests/                    # 测试文件
├── dist/                     # 构建产物
├── release/                  # 打包产物
├── build/                    # 打包资源，如 icon.png / icon.ico
├── package.json
├── vite.config.ts
├── tsconfig.node.json
└── electron-builder.yml
```

## 安装依赖

```bash
npm install
```

## 开发运行

```bash
npm run dev
```

## 构建

```bash
npm run build
```

只构建主进程：

```bash
npm run build:main
```

只构建渲染端：

```bash
npm run build:renderer
```

## 测试

```bash
npm test
```

监听模式：

```bash
npm run test:watch
```

## 打包

默认打包：

```bash
npm run package
```

Windows：

```bash
npm run package:win
```

Linux：

```bash
npm run package:linux
```

macOS：

```bash
npm run package:mac
```

### 打包说明

当前 `electron-builder.yml` 中配置了：

- Windows：NSIS 安装包
- Linux：deb 安装包
- macOS：dmg 安装包

图标资源位于：

```text
build/icon.png
build/icon.ico
```

应用打包输出目录为：

```text
release/
```

在 Linux 环境下交叉打包 Windows 安装包通常需要安装 `wine`。如果缺少 `wine`，`electron-builder --win` 可能会失败。

## 使用方法

### 0. 直接下载使用

如果你只是使用软件，不需要自己开发或构建，可以直接到项目的 `release/` 目录下载已经打包好的安装包。

当前 release 目录示例：

```text
release/
├── 词达人助手-1.0.0-win-x64.exe        # Windows 安装包
├── 词达人助手-1.0.0-win-x64.exe.blockmap
├── win-unpacked/                       # Windows 解包目录
└── linux-unpacked/                     # Linux 解包目录
```

Windows 用户推荐下载并运行：

```text
release/词达人助手-1.0.0-win-x64.exe
```

Linux 用户如果生成了 deb 包，则下载类似下面的文件安装：

```text
release/词达人助手-1.0.0-linux-x64.deb
```

也可以进入 `linux-unpacked/` 目录直接运行解包后的程序。

### 1. 配置模型

打开应用后，点击右上角 **设置**。

在 **LLM 设置** 中选择 API 类型：

- 自定义 API
- 轨迹流动 API

如果选择 **自定义 API**，需要填写：

```text
LLM_URL
LLM_MODEL
LLM_KEY
```

如果选择 **轨迹流动 API**，接口地址会自动使用：

```text
https://api.siliconflow.cn/v1
```

此时只需要填写：

```text
LLM_MODEL
LLM_KEY
```

可以点击 **测试模型连通性** 检查配置是否可用。

### 2. 获取 Token

进入 **抓包** 页面。

建议流程：

1. 先打开词达人页面，确保账号已经登录成功。
2. 回到本工具，点击 **开始抓包**。
3. 刷新词达人页面。
4. 成功捕获后，应用会自动保存 Token，并播放成功提示音。

捕获的字段包括：

```text
USERTOKEN
ABC
AUTH_V
```

如果 Token 不完整或不可用，账号信息区域会显示红色状态。可以点击 **校验是否可用** 检查当前鉴权信息是否有效。

### 3. 启动任务

进入 **任务** 页面，加载任务列表后，可以选择班级任务或自学任务启动。

运行期间可以查看：

- 当前任务状态
- 答题日志
- 任务完成状态
- 托盘中的任务进度

### 4. 系统托盘

应用关闭窗口时不会直接退出，而是最小化到托盘。

托盘菜单会显示：

- 当前是否有运行任务
- 正在进行的任务数量
- 任务名称
- 当前轮次
- 当前进度
- 最近一条日志

托盘菜单还提供：

- 显示窗口
- 刷新任务状态
- 退出

## 配置文件

应用配置保存在 Electron 的 `userData` 目录中，文件名为：

```text
config.json
```

主要配置项：

```text
USERTOKEN
ABC
AUTH_V
LLM_URL
LLM_KEY
LLM_MODEL
COURSE_ID
STUDY_GRADE
```

## 音效和图标

资源目录：

```text
src/renderer/assets/
```

当前使用：

```text
icon.png       # 应用图标、左上角图标
click.wav      # 点击音效
success.wav    # 成功提示音
```

## LLM 限速处理

应用内置了 LLM 请求队列和退避机制：

- 全局串行化 LLM 请求。
- 请求之间有最小间隔。
- 遇到 `429`、`too many requests`、`rate limit` 时会等待后重试。
- 做题过程中如果 LLM 暂时不可用，会暂停当前题等待恢复，不会盲猜提交。

## 代理和证书注意事项

抓包功能会启动本地代理，并可能生成/安装 CA 证书。

使用前请注意：

- 本地代理可能影响系统网络。
- 程序会尝试修改系统代理配置。
- CA 证书仅应在可信环境中使用。
- 如果异常退出导致网络异常，可手动检查系统代理设置。

## 常见问题

### Windows 打包失败提示需要 wine

在 Linux 上交叉打 Windows 安装包需要 `wine`。

可以在系统中安装 wine 后重试：

```bash
npm run package:win
```

### Linux 打包下载 Electron 失败

如果打包时下载 Electron 压缩包失败，通常是网络连接 GitHub 不稳定。

可以：

- 切换网络环境
- 配置 Electron 镜像
- 使用本地缓存
- 重试打包命令

### 托盘点击没有反应

不同 Linux 桌面环境对 Electron 托盘支持不同。本项目已使用 `setContextMenu` 提高兼容性。若仍无法显示，请检查当前桌面环境是否支持系统托盘或 AppIndicator。

## 免责声明

本项目仅用于学习、研究和个人自动化实践。项目涉及第三方平台接口和鉴权信息，请勿用于违反平台规则、影响他人权益或未经授权的场景。使用本项目造成的账号、数据或网络风险由使用者自行承担。
