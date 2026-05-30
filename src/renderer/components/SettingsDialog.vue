<script setup lang="ts">
/**
 * SettingsDialog - 设置抽屉
 * LLM 配置、课程设置、代理端口等
 */
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

// ── 类型 ──

interface ConfigData {
  USERTOKEN: string
  ABC: string
  AUTH_V: string
  COURSE_ID: string
  STUDY_GRADE: string
  LLM_URL: string
  LLM_MODEL: string
  LLM_KEY: string
}

// ── Props & Emits ──

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: []
}>()

// ── 状态 ──

const config = ref<ConfigData>({
  USERTOKEN: '',
  ABC: '',
  AUTH_V: '',
  COURSE_ID: '',
  STUDY_GRADE: '',
  LLM_URL: '',
  LLM_MODEL: '',
  LLM_KEY: '',
})
const configLoading = ref(false)
const configSaving = ref(false)
const envFilePath = ref('')
const missingAuth = ref<string[]>([])
const llmTesting = ref(false)
const llmTestResult = ref('')
const llmTestOk = ref(false)
const llmProvider = ref<'custom' | 'siliconflow'>('custom')

const defaultCustomLlmUrl = 'https://ai.saurlax.com/v1'
const defaultCustomLlmModel = 'step-3.6'
const siliconFlowUrl = 'https://api.siliconflow.cn/v1'
const siliconFlowOfficialUrl = 'https://cloud.siliconflow.cn/account/ak'
const siliconFlowDefaultModel = 'Qwen/Qwen2.5-7B-Instruct'

const customLlmUrlCache = ref(defaultCustomLlmUrl)
const customLlmModelCache = ref(defaultCustomLlmModel)
const customLlmKeyCache = ref('')
const siliconFlowModelCache = ref(siliconFlowDefaultModel)
const siliconFlowKeyCache = ref('')

// ── 方法 ──

async function loadConfig() {
  configLoading.value = true
  try {
    const res = await window.cidaren.getConfig()
    if (!res.ok) {
      ElMessage.error('读取配置失败')
      return
    }
    config.value = {
      USERTOKEN: res.config.USERTOKEN || '',
      ABC: res.config.ABC || '',
      AUTH_V: res.config.AUTH_V || '',
      COURSE_ID: res.config.COURSE_ID || '',
      STUDY_GRADE: res.config.STUDY_GRADE || '',
      LLM_URL: res.config.LLM_URL || '',
      LLM_MODEL: res.config.LLM_MODEL || '',
      LLM_KEY: res.config.LLM_KEY || '',
    }
    envFilePath.value = res.envFile || ''
    missingAuth.value = res.missingAuth || []
    llmProvider.value = config.value.LLM_URL.trim() === siliconFlowUrl ? 'siliconflow' : 'custom'
    if (llmProvider.value === 'siliconflow') {
      siliconFlowModelCache.value = config.value.LLM_MODEL || siliconFlowDefaultModel
      siliconFlowKeyCache.value = config.value.LLM_KEY || ''
    } else {
      customLlmUrlCache.value = config.value.LLM_URL || defaultCustomLlmUrl
      customLlmModelCache.value = config.value.LLM_MODEL || defaultCustomLlmModel
      customLlmKeyCache.value = config.value.LLM_KEY || ''
    }
  } catch (e) {
    ElMessage.error('读取配置失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    configLoading.value = false
  }
}

async function saveConfig() {
  configSaving.value = true
  try {
    const res = await window.cidaren.saveConfig({ ...config.value })
    if (!res.ok) {
      ElMessage.error('保存配置失败')
      return
    }
    ElMessage.success('配置已保存')
    await loadConfig()
    emit('saved')
  } catch (e) {
    ElMessage.error('保存配置失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    configSaving.value = false
  }
}

async function testLlm() {
  // 先保存当前配置再测试
  await saveConfig()
  llmTesting.value = true
  llmTestResult.value = ''
  try {
    const res = await window.cidaren.testLlm()
    if (res.ok) {
      llmTestOk.value = true
      llmTestResult.value = `连接成功! 模型回复: "${res.reply}" (${res.model})`
    } else {
      llmTestOk.value = false
      llmTestResult.value = `连接失败: ${res.error}`
    }
  } catch (e) {
    llmTestOk.value = false
    llmTestResult.value = `测试异常: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    llmTesting.value = false
  }
}

function handleLlmProviderChange(provider: 'custom' | 'siliconflow') {
  const currentIsSiliconFlow = config.value.LLM_URL.trim() === siliconFlowUrl
  if (currentIsSiliconFlow) {
    siliconFlowModelCache.value = config.value.LLM_MODEL || siliconFlowDefaultModel
    siliconFlowKeyCache.value = config.value.LLM_KEY || ''
  } else {
    customLlmUrlCache.value = config.value.LLM_URL || defaultCustomLlmUrl
    customLlmModelCache.value = config.value.LLM_MODEL || defaultCustomLlmModel
    customLlmKeyCache.value = config.value.LLM_KEY || ''
  }

  if (provider === 'siliconflow') {
    config.value.LLM_URL = siliconFlowUrl
    config.value.LLM_MODEL = siliconFlowModelCache.value || siliconFlowDefaultModel
    config.value.LLM_KEY = siliconFlowKeyCache.value
    ElMessage.success('已切换为轨迹流动 API，只需填写 Key 和模型名')
    return
  }

  config.value.LLM_URL = customLlmUrlCache.value || defaultCustomLlmUrl
  config.value.LLM_MODEL = customLlmModelCache.value || defaultCustomLlmModel
  config.value.LLM_KEY = customLlmKeyCache.value
}

function openSiliconFlowOfficial() {
  window.cidaren.openExternal(siliconFlowOfficialUrl)
}

async function copySiliconFlowOfficialUrl() {
  try {
    await navigator.clipboard.writeText(siliconFlowOfficialUrl)
    ElMessage.success('轨迹流动官网链接已复制')
  } catch (e) {
    ElMessage.error('复制失败: ' + (e instanceof Error ? e.message : String(e)))
  }
}

function close() {
  emit('update:visible', false)
}

// ── Watch ──

watch(
  () => props.visible,
  (val) => {
    if (val) {
      loadConfig()
    }
  }
)

defineExpose({ loadConfig })
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="设置"
    direction="rtl"
    size="480px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="settings-content" v-loading="configLoading">
      <!-- 鉴权状态 -->
      <div class="settings-section">
        <div class="section-header">
          <el-icon><Key /></el-icon>
          <span>鉴权状态</span>
          <el-tag
            :type="missingAuth.length === 0 ? 'success' : 'warning'"
            size="small"
            round
            style="margin-left: auto"
          >
            {{ missingAuth.length === 0 ? '完整' : `缺少: ${missingAuth.join(', ')}` }}
          </el-tag>
        </div>
      </div>

      <!-- Token 配置 -->
      <div class="settings-section">
        <div class="section-header">
          <el-icon><Lock /></el-icon>
          <span>Token 配置</span>
        </div>
        <el-form label-position="top" size="default">
          <el-form-item label="USERTOKEN">
            <el-input
              v-model="config.USERTOKEN"
              type="password"
              show-password
              placeholder="词达人请求头中的 usertoken"
            />
          </el-form-item>
          <el-form-item label="ABC">
            <el-input
              v-model="config.ABC"
              type="password"
              show-password
              placeholder="词达人请求头中的 abc"
            />
          </el-form-item>
          <el-form-item label="AUTH_V">
            <el-input
              v-model="config.AUTH_V"
              type="password"
              show-password
              placeholder="词达人请求头中的 authorization-v"
            />
          </el-form-item>
        </el-form>
      </div>

      <!-- 课程设置 -->
      <div class="settings-section">
        <div class="section-header">
          <el-icon><Reading /></el-icon>
          <span>课程设置</span>
        </div>
        <el-form label-position="top" size="default">
          <el-form-item label="COURSE_ID">
            <el-input v-model="config.COURSE_ID" placeholder="CET4_v2" />
          </el-form-item>
          <el-form-item label="STUDY_GRADE">
            <el-select v-model="config.STUDY_GRADE" placeholder="选择学习等级" style="width: 100%">
              <el-option label="1 - 快速" value="1" />
              <el-option label="2 - 普通" value="2" />
              <el-option label="3 - 完整" value="3" />
              <el-option label="4 - 超级困难" value="4" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>

      <!-- LLM 设置 -->
      <div class="settings-section">
        <div class="section-header">
          <el-icon><Cpu /></el-icon>
          <span>LLM 设置</span>
        </div>
        <el-form label-position="top" size="default">
          <el-form-item label="API 类型">
            <el-select
              v-model="llmProvider"
              placeholder="请选择 API 类型"
              style="width: 100%"
              @change="handleLlmProviderChange"
            >
              <el-option label="自定义 API" value="custom" />
              <el-option label="轨迹流动 API" value="siliconflow" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="llmProvider === 'custom'" label="LLM_URL">
            <el-input v-model="config.LLM_URL" :placeholder="defaultCustomLlmUrl" />
          </el-form-item>
          <el-form-item v-else label="LLM_URL">
            <el-input :model-value="siliconFlowUrl" disabled />
            <div class="form-tip">轨迹流动 API 已固定接口地址，只需要填写 Key 和模型名称。</div>
            <div class="siliconflow-actions">
              <el-button size="small" type="primary" plain @click="openSiliconFlowOfficial">
                打开官网获取 Key
              </el-button>
              <el-button size="small" plain @click="copySiliconFlowOfficialUrl">
                复制官网链接
              </el-button>
            </div>
          </el-form-item>
          <el-form-item label="LLM_MODEL">
            <el-input
              v-model="config.LLM_MODEL"
              :placeholder="llmProvider === 'siliconflow' ? siliconFlowDefaultModel : defaultCustomLlmModel"
            />
          </el-form-item>
          <el-form-item label="LLM_KEY">
            <el-input
              v-model="config.LLM_KEY"
              type="password"
              show-password
              placeholder="Bearer token / API Key"
            />
          </el-form-item>
        </el-form>
        <el-button
          type="primary"
          plain
          :loading="llmTesting"
          @click="testLlm"
          style="width: 100%"
        >
          测试模型连通性
        </el-button>
        <div v-if="llmTestResult" class="llm-test-result" :class="{ success: llmTestOk, error: !llmTestOk }">
          {{ llmTestResult }}
        </div>
      </div>

      <!-- 文件路径 -->
      <div v-if="envFilePath" class="env-path">
        <el-icon><Document /></el-icon>
        <span>{{ envFilePath }}</span>
      </div>
    </div>

    <template #footer>
      <div class="settings-footer">
        <el-button @click="close">取消</el-button>
        <el-button type="primary" :loading="configSaving" @click="saveConfig">
          保存配置
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.settings-content {
  padding: 0 4px;
}

.settings-section {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.section-header .el-icon {
  color: #409eff;
}

.env-path {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: #f8f9fa;
  border-radius: 8px;
  font-size: 12px;
  color: #909399;
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

:deep(.el-form-item) {
  margin-bottom: 14px;
}

:deep(.el-form-item__label) {
  font-size: 12px;
  color: #606266;
}

.llm-test-result {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.llm-test-result.success {
  background: #f0f9eb;
  color: #67c23a;
}

.llm-test-result.error {
  background: #fef0f0;
  color: #f56c6c;
}

.form-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #909399;
}

.siliconflow-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
