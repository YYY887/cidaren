<script setup lang="ts">
/**
 * CaptureTab - 抓包获取 Token 主界面
 * 包含授权链接、代理控制、CA证书状态、账号信息、手动Token输入
 */
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  VideoPlay,
  VideoPause,
  Connection,
  CopyDocument,
  Link,
  FolderOpened,
  CircleCheck,
  Warning,
  Plus,
} from '@element-plus/icons-vue'
import LogPanel from './LogPanel.vue'

// ── Props & Emits ──

const emit = defineEmits<{
  tokensCaptured: [tokens: { usertoken: string; abc: string; authV: string }]
}>()

// ── 状态 ──

const proxyRunning = ref(false)
const proxyPort = ref(8899)
const proxyCaCertPath = ref('')
const proxyLogs = ref<string[]>([])
const proxyStarting = ref(false)

const capturedToken = ref('')
const capturedAbc = ref('')
const capturedAuthV = ref('')
const authChecking = ref(false)
const authValid = ref<boolean | null>(null)
const authCheckMsg = ref('未校验')

const manualToken = ref('')

const vocabgoUrl = 'https://app.vocabgo.com/student/#/student/home'

// ── 方法 ──

async function loadProxyStatus() {
  try {
    const res = await window.cidaren.getProxyStatus()
    if (res.ok) {
      proxyRunning.value = res.running
      proxyPort.value = res.port
      proxyCaCertPath.value = res.caCertPath
    }
  } catch {
    // ignore
  }
}

async function startProxy() {
  proxyStarting.value = true
  try {
    const res = await window.cidaren.startProxy()
    if (!res.ok) {
      ElMessage.error('启动代理失败: ' + (res.error || '未知错误'))
      return
    }
    proxyRunning.value = true
    proxyPort.value = res.port || 8899
    proxyCaCertPath.value = res.caCertPath || ''
    ElMessage.success('代理已启动')
  } catch (e) {
    ElMessage.error('启动代理失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    proxyStarting.value = false
  }
}

async function stopProxy() {
  proxyStarting.value = true
  try {
    const res = await window.cidaren.stopProxy()
    if (!res.ok) {
      ElMessage.error('停止代理失败: ' + (res.error || '未知错误'))
      return
    }
    proxyRunning.value = false
    ElMessage.success('代理已停止')
  } catch (e) {
    ElMessage.error('停止代理失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    proxyStarting.value = false
  }
}

function copyUrl() {
  navigator.clipboard.writeText(vocabgoUrl)
  ElMessage.success('链接已复制，请发送到微信中打开')
}

function copyCaCertPath() {
  if (proxyCaCertPath.value) {
    navigator.clipboard.writeText(proxyCaCertPath.value)
    ElMessage.success('CA 证书路径已复制')
  }
}

function openCaCertDir() {
  if (proxyCaCertPath.value) {
    // Open the directory containing the cert
    const dir = proxyCaCertPath.value.replace(/[/\\][^/\\]+$/, '')
    window.cidaren.openExternal(dir)
  }
}

function addManualToken() {
  const token = manualToken.value.trim()
  if (!token) {
    ElMessage.warning('请输入 Token')
    return
  }
  // Emit as a captured token (only usertoken for manual entry)
  emit('tokensCaptured', { usertoken: token, abc: '', authV: '' })
  capturedToken.value = token
  capturedAbc.value = ''
  capturedAuthV.value = ''
  authValid.value = false
  authCheckMsg.value = '缺少 ABC / Auth-V'
  manualToken.value = ''
  ElMessage.success('Token 已添加')
}

function handleTokensCaptured(tokens: { usertoken: string; abc: string; authV: string }) {
  capturedToken.value = tokens.usertoken
  capturedAbc.value = tokens.abc
  capturedAuthV.value = tokens.authV
  authValid.value = null
  authCheckMsg.value = '待校验'
  // 代理会被自动停止，更新 UI 状态
  proxyRunning.value = false
  proxyStarting.value = false
  emit('tokensCaptured', tokens)
  ElMessage.success('Token 已自动捕获并填入配置')
  window.setTimeout(() => {
    void checkAuthAvailable(false)
  }, 300)
}

async function checkAuthAvailable(showToast = true) {
  if (!capturedToken.value || !capturedAbc.value || !capturedAuthV.value) {
    authValid.value = false
    authCheckMsg.value = '鉴权信息不完整'
    if (showToast) ElMessage.warning('请先获取完整 Token / ABC / Auth-V')
    return
  }

  authChecking.value = true
  authCheckMsg.value = '校验中...'
  try {
    const res = await window.cidaren.getTasks()
    if (res.ok) {
      authValid.value = true
      authCheckMsg.value = '可用'
      if (showToast) ElMessage.success('Token 可用')
      return
    }

    authValid.value = false
    authCheckMsg.value = res.error || '不可用'
    if (showToast) ElMessage.error('Token 不可用: ' + authCheckMsg.value)
  } catch (e) {
    authValid.value = false
    authCheckMsg.value = e instanceof Error ? e.message : String(e)
    if (showToast) ElMessage.error('Token 校验失败: ' + authCheckMsg.value)
  } finally {
    authChecking.value = false
  }
}

function handleProxyLog(msg: string) {
  proxyLogs.value.push(msg)
  if (proxyLogs.value.length > 100) {
    proxyLogs.value = proxyLogs.value.slice(-100)
  }
}

function clearLogs() {
  proxyLogs.value = []
}

function maskToken(token: string): string {
  if (!token) return '未获取'
  if (token.length <= 8) return '****'
  return token.slice(0, 4) + '****' + token.slice(-4)
}

// ── 生命周期 ──

onMounted(async () => {
  await loadProxyStatus()
  // 加载已保存的 token 显示
  await loadSavedTokens()
  window.cidaren.onProxyLog(handleProxyLog)
  window.cidaren.onTokensCaptured(handleTokensCaptured)
})

/** 从配置中加载已保存的 token */
async function loadSavedTokens() {
  try {
    const res = await window.cidaren.getConfig()
    if (res.ok && res.config) {
      capturedToken.value = res.config.USERTOKEN || ''
      capturedAbc.value = res.config.ABC || ''
      capturedAuthV.value = res.config.AUTH_V || ''
      authValid.value = capturedToken.value && capturedAbc.value && capturedAuthV.value ? null : false
      authCheckMsg.value = authValid.value === false ? '鉴权信息不完整' : '待校验'
    }
  } catch { /* ignore */ }
}

// Expose for parent to call loadProxyStatus
defineExpose({ loadProxyStatus })
</script>

<template>
  <div class="capture-tab">
    <div class="capture-tab__left">
      <!-- 授权链接 -->
      <div class="card">
        <div class="card__header">
          <el-icon class="card__icon"><Link /></el-icon>
          <span>授权链接</span>
        </div>
        <div class="card__body">
          <el-input
            :model-value="vocabgoUrl"
            readonly
            size="large"
          >
            <template #append>
              <el-button :icon="CopyDocument" @click="copyUrl">复制</el-button>
            </template>
          </el-input>
          <p class="hint-text" style="margin-top: 8px">
            复制链接后发送到微信中打开并登录
          </p>
        </div>
      </div>

      <!-- 代理控制 -->
      <div class="card">
        <div class="card__header">
          <el-icon class="card__icon"><Connection /></el-icon>
          <span>代理抓包</span>
          <el-tag
            :type="proxyRunning ? 'success' : 'info'"
            size="small"
            round
            style="margin-left: auto"
          >
            {{ proxyRunning ? `运行中 :${proxyPort}` : '未启动' }}
          </el-tag>
        </div>
        <div class="card__body">
          <div class="proxy-buttons">
            <el-button
              type="success"
              size="large"
              :icon="VideoPlay"
              :loading="proxyStarting && !proxyRunning"
              :disabled="proxyRunning"
              @click="startProxy"
              class="proxy-btn"
            >
              开始抓包
            </el-button>
            <el-button
              type="danger"
              size="large"
              :icon="VideoPause"
              :loading="proxyStarting && proxyRunning"
              :disabled="!proxyRunning"
              @click="stopProxy"
              class="proxy-btn"
            >
              停止
            </el-button>
          </div>
          <p class="hint-text">
            启动后设置系统代理为 <code>127.0.0.1:{{ proxyPort }}</code>，然后访问词达人
          </p>
        </div>
      </div>

      <!-- CA 证书 -->
      <div class="card">
        <div class="card__header">
          <el-icon class="card__icon"><Document /></el-icon>
          <span>CA 证书</span>
          <el-tag
            :type="proxyCaCertPath ? 'success' : 'warning'"
            size="small"
            round
            style="margin-left: auto"
          >
            <el-icon style="margin-right: 2px">
              <CircleCheck v-if="proxyCaCertPath" />
              <Warning v-else />
            </el-icon>
            {{ proxyCaCertPath ? '已生成' : '未生成' }}
          </el-tag>
        </div>
        <div class="card__body">
          <div v-if="proxyCaCertPath" class="cert-actions">
            <el-button size="small" :icon="CopyDocument" @click="copyCaCertPath">
              复制路径
            </el-button>
            <el-button size="small" :icon="FolderOpened" @click="openCaCertDir">
              打开目录
            </el-button>
          </div>
          <p v-else class="hint-text">启动代理后自动生成证书</p>
        </div>
      </div>

      <!-- 账号信息 -->
      <div class="card">
        <div class="card__header">
          <el-icon class="card__icon"><User /></el-icon>
          <span>账号信息</span>
          <el-tag
            :type="authValid === true ? 'success' : authValid === false ? 'danger' : 'info'"
            size="small"
            round
            style="margin-left: auto"
          >
            {{ authCheckMsg }}
          </el-tag>
        </div>
        <div class="card__body">
          <div class="token-info">
            <div class="token-row">
              <span class="token-label">Token:</span>
              <span class="token-value" :class="{ active: capturedToken && authValid !== false, invalid: capturedToken && authValid === false }">
                {{ maskToken(capturedToken) }}
              </span>
            </div>
            <div class="token-row">
              <span class="token-label">ABC:</span>
              <span class="token-value" :class="{ active: capturedAbc && authValid !== false, invalid: capturedAbc && authValid === false }">
                {{ maskToken(capturedAbc) }}
              </span>
            </div>
            <div class="token-row">
              <span class="token-label">Auth-V:</span>
              <span class="token-value" :class="{ active: capturedAuthV && authValid !== false, invalid: capturedAuthV && authValid === false }">
                {{ maskToken(capturedAuthV) }}
              </span>
            </div>
          </div>
          <el-button
            class="auth-check-btn"
            size="small"
            :type="authValid === false ? 'danger' : 'primary'"
            plain
            :loading="authChecking"
            :disabled="!capturedToken || !capturedAbc || !capturedAuthV"
            @click="checkAuthAvailable()"
          >
            校验是否可用
          </el-button>
          <el-divider />
          <div class="manual-token">
            <el-input
              v-model="manualToken"
              placeholder="粘贴 Token 手动添加"
              size="small"
              clearable
            >
              <template #append>
                <el-button :icon="Plus" @click="addManualToken">添加</el-button>
              </template>
            </el-input>
          </div>
        </div>
      </div>
    </div>

    <div class="capture-tab__right">
      <div class="card card--full-height">
        <LogPanel
          :logs="proxyLogs"
          title="运行日志"
          :clearable="true"
          @clear="clearLogs"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.capture-tab {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 20px;
  height: 100%;
}

.capture-tab__left {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.capture-tab__right {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.card--full-height {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  border-bottom: 1px solid #f5f5f5;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.card__icon {
  color: #409eff;
  font-size: 16px;
}

.card__body {
  padding: 16px 18px;
}

.proxy-buttons {
  display: flex;
  gap: 12px;
}

.proxy-btn {
  flex: 1;
  border-radius: 10px;
  font-weight: 600;
}

.hint-text {
  margin: 10px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}

.hint-text code {
  background: #f2f4f7;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.cert-actions {
  display: flex;
  gap: 8px;
}

.token-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.token-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.token-label {
  font-size: 12px;
  color: #909399;
  min-width: 50px;
}

.token-value {
  font-size: 12px;
  color: #c0c4cc;
  font-family: 'JetBrains Mono', monospace;
}

.token-value.active {
  color: #67c23a;
}

.token-value.invalid {
  color: #f56c6c;
}

.auth-check-btn {
  width: 100%;
  margin-top: 12px;
}

.manual-token {
  margin-top: 0;
}

.el-divider {
  margin: 12px 0;
}

@media (max-width: 800px) {
  .capture-tab {
    grid-template-columns: 1fr;
  }
}
</style>
