<script setup lang="ts">
/**
 * TaskTab - 任务管理面板
 * 展示任务列表、进度、分数，提供启动/停止/循环/日志操作
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Refresh,
  VideoPlay,
  RefreshRight,
  CircleClose,
  Document,
} from '@element-plus/icons-vue'

// ── 类型 ──

interface TaskItem {
  source: 'class' | 'study'
  sourceLabel: string
  taskId: number
  releaseId: number | string
  taskName: string
  progress: number
  score: number | null
  running: boolean
  done: boolean
  exitCode: number | null
  loop: boolean
  round: number
  canStart: boolean
  courseId?: string
  listId?: string
  taskType?: number
  grade?: number
}

// ── 状态 ──

const tasks = ref<TaskItem[]>([])
const taskLoading = ref(false)
const taskStatusText = ref('加载中...')

const logDrawerVisible = ref(false)
const logTitle = ref('任务日志')
const logContent = ref<string[]>([])
const logTaskKey = ref('')
const logDone = ref(false)

let taskTimer: ReturnType<typeof setInterval> | null = null
let logTimer: ReturnType<typeof setInterval> | null = null

// ── 计算属性 ──

const classTasks = computed(() => tasks.value.filter(t => t.source === 'class' && t.canStart))
const studyTasks = computed(() => tasks.value.filter(t => t.source === 'study' && t.canStart))

// ── 方法 ──

const emit = defineEmits<{
  tokenExpired: []
}>()

async function loadTasks() {
  taskLoading.value = true
  try {
    const res = await window.cidaren.getTasks()
    if (!res.ok) {
      const error = (res as { error?: string }).error || ''
      // 检测 token 过期
      if (error.includes('请先在配置面板填写') || error.includes('token') || error.includes('鉴权')) {
        taskStatusText.value = 'Token 已过期，请重新抓包'
        emit('tokenExpired')
        ElMessage.warning('Token 已过期，请切换到抓包页面重新获取')
      } else {
        ElMessage.error('获取任务失败: ' + error)
        taskStatusText.value = '获取任务失败'
      }
      return
    }
    tasks.value = res.tasks || []
    // 检查返回的任务是否为空且有警告（可能是 token 问题）
    if (tasks.value.length === 0 && (res.warnings || []).some((w: string) => w.includes('失败'))) {
      taskStatusText.value = '获取任务异常，可能需要重新抓包'
      emit('tokenExpired')
    } else {
      const time = new Date().toLocaleTimeString()
      const warnings = (res.warnings || []).length > 0 ? ` | ${res.warnings.join(' | ')}` : ''
      taskStatusText.value = `${tasks.value.length} 个任务 | ${time}${warnings}`
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ElMessage.error('获取任务失败: ' + msg)
    taskStatusText.value = msg
  } finally {
    taskLoading.value = false
  }
}

async function startTask(task: TaskItem, loop: boolean) {
  try {
    const res = await window.cidaren.startTask({
      source: task.source,
      taskId: task.taskId,
      releaseId: task.releaseId,
      courseId: task.courseId,
      listId: task.listId,
      taskType: task.taskType,
      grade: task.grade,
      loop,
    })
    if (!res.ok) {
      ElMessage.error('启动失败: ' + ((res as { error?: string }).error || '未知错误'))
      return
    }
    ElMessage.success(loop ? '循环任务已启动' : '任务已启动')
    showLogs(task)
    await loadTasks()
  } catch (e) {
    ElMessage.error('启动失败: ' + (e instanceof Error ? e.message : String(e)))
  }
}

async function stopTask(task: TaskItem) {
  try {
    const res = await window.cidaren.stopTask({
      source: task.source,
      taskId: task.taskId,
      releaseId: task.releaseId,
    })
    if (!res.ok) {
      ElMessage.error('停止失败: ' + ((res as { error?: string }).error || '未知错误'))
      return
    }
    ElMessage.success('任务已停止')
    await loadTasks()
  } catch (e) {
    ElMessage.error('停止失败: ' + (e instanceof Error ? e.message : String(e)))
  }
}

// ── 日志 ──

/** 全局日志存储 - 按 taskKey 保存所有日志，永不清除（除非用户手动清） */
const allLogs = new Map<string, string[]>()

function buildTaskKey(task: TaskItem): string {
  return `${task.source}:${task.taskId}:${task.releaseId}`
}

async function showLogs(task: TaskItem) {
  logTaskKey.value = buildTaskKey(task)
  logTitle.value = task.taskName
  logDone.value = false
  logDrawerVisible.value = true

  // 从后端拉取一次完整日志
  await refreshLogs()

  // 启动定时刷新（每 2s），仅在后端有更多日志时更新
  if (logTimer) clearInterval(logTimer)
  logTimer = setInterval(refreshLogs, 2000)
}

async function refreshLogs() {
  if (!logTaskKey.value) return
  try {
    const [source, taskId, releaseId] = logTaskKey.value.split(':')
    const res = await window.cidaren.getLogs([source, taskId, releaseId])
    const backendLogs = res.logs || []

    // 用后端日志和本地日志取较长的那个（防止丢失）
    const localLogs = allLogs.get(logTaskKey.value) || []
    if (backendLogs.length > localLogs.length) {
      allLogs.set(logTaskKey.value, [...backendLogs])
      logContent.value = [...backendLogs]
      await nextTick()
      scrollToBottom()
    } else {
      // 本地有更多日志（IPC push 先到），用本地的
      logContent.value = [...localLogs]
    }

    logDone.value = res.done || false
    if (res.done) {
      // 任务结束后延迟 500ms 再做一次最终刷新，捕获迟到的日志
      if (logTimer) { clearInterval(logTimer); logTimer = null }
      setTimeout(async () => {
        await refreshLogs()
      }, 500)
    }
  } catch {
    // ignore
  }
}

function scrollToBottom() {
  const logEl = document.getElementById('task-log-container')
  if (logEl) {
    logEl.scrollTop = logEl.scrollHeight
  }
}

function closeLogs() {
  logDrawerVisible.value = false
  // 不清除 logTaskKey 和日志内容，下次打开还能看到
  if (logTimer) {
    clearInterval(logTimer)
    logTimer = null
  }
}

function getProgressColor(progress: number): string {
  if (progress >= 100) return '#67c23a'
  if (progress >= 50) return '#409eff'
  return '#e6a23c'
}

// ── IPC 事件 ──

function handleTaskLog(key: string, msg: string) {
  // 始终保存到全局日志存储
  if (!allLogs.has(key)) {
    allLogs.set(key, [])
  }
  allLogs.get(key)!.push(msg)

  // 如果当前正在查看这个任务的日志，更新显示
  if (key === logTaskKey.value) {
    logContent.value = [...allLogs.get(key)!]
    nextTick(scrollToBottom)
  }
}

function handleTaskDone(key: string) {
  if (key === logTaskKey.value) {
    logDone.value = true
    if (logTimer) {
      clearInterval(logTimer)
      logTimer = null
    }
    // 最后拉取一次确保完整
    refreshLogs()
  }
  loadTasks()
}

// ── 生命周期 ──

onMounted(async () => {
  window.cidaren.onTaskLog(handleTaskLog)
  window.cidaren.onTaskDone(handleTaskDone)
  await loadTasks()
  taskTimer = setInterval(loadTasks, 5000)
})

onUnmounted(() => {
  if (taskTimer) {
    clearInterval(taskTimer)
    taskTimer = null
  }
  if (logTimer) {
    clearInterval(logTimer)
    logTimer = null
  }
})
</script>

<template>
  <div class="task-tab">
    <div class="task-tab__toolbar">
      <el-button :icon="Refresh" :loading="taskLoading" @click="loadTasks">
        刷新
      </el-button>
      <span class="task-tab__status">{{ taskStatusText }}</span>
    </div>

    <div class="task-tab__content">
      <!-- 班级任务 -->
      <div class="task-section">
        <h3 class="section-title">班级任务 ({{ classTasks.length }})</h3>
        <div class="task-section__table">
          <el-table
            v-if="classTasks.length > 0"
            :data="classTasks"
            stripe
            size="default"
            :header-cell-style="{ background: '#fafbfc', color: '#606266', fontWeight: 600 }"
          >
            <el-table-column type="index" label="#" width="50" />
            <el-table-column label="任务名" min-width="200">
              <template #default="{ row }">
                <span class="task-name">{{ row.taskName }}</span>
              </template>
            </el-table-column>
            <el-table-column label="进度" width="160">
              <template #default="{ row }">
                <el-progress
                  :percentage="row.progress || 0"
                  :color="getProgressColor(row.progress || 0)"
                  :stroke-width="8"
                  style="width: 110px"
                />
              </template>
            </el-table-column>
            <el-table-column label="分数" width="80" align="center">
              <template #default="{ row }">
                <span class="score" :class="{ perfect: row.score >= 100 }">
                  {{ row.score == null ? '-' : row.score }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120" align="center">
              <template #default="{ row }">
                <el-tag v-if="!row.canStart" size="small" type="danger" effect="light" round>已截止</el-tag>
                <el-tag v-else-if="row.running && row.loop" size="small" type="warning" effect="light" round>循环中</el-tag>
                <el-tag v-else-if="row.running" size="small" type="primary" effect="light" round>运行中</el-tag>
                <el-tag v-else-if="row.done" size="small" type="success" effect="light" round>已完成</el-tag>
                <el-tag v-else size="small" type="info" effect="plain" round>待执行</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="240" align="center">
              <template #default="{ row }">
                <template v-if="!row.canStart">
                  <el-tag size="small" type="danger" effect="light" round>已截止</el-tag>
                </template>
                <template v-else-if="row.running">
                  <el-button size="small" type="danger" :icon="CircleClose" round @click="stopTask(row)">停止</el-button>
                  <el-button size="small" :icon="Document" round @click="showLogs(row)">日志</el-button>
                </template>
                <template v-else>
                  <el-button size="small" type="primary" :icon="VideoPlay" round @click="startTask(row, false)">启动</el-button>
                  <el-button size="small" type="warning" :icon="RefreshRight" round @click="startTask(row, true)">循环</el-button>
                  <el-button v-if="row.done" size="small" :icon="Document" round @click="showLogs(row)">日志</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无班级任务" :image-size="60" />
        </div>
      </div>

      <!-- 自学任务 -->
      <div class="task-section">
        <h3 class="section-title">自学任务 ({{ studyTasks.length }})</h3>
        <div class="task-section__table">
          <el-table
            v-if="studyTasks.length > 0"
            :data="studyTasks"
            stripe
            size="default"
            :header-cell-style="{ background: '#fafbfc', color: '#606266', fontWeight: 600 }"
          >
            <el-table-column type="index" label="#" width="50" />
            <el-table-column label="任务名" min-width="200">
              <template #default="{ row }">
                <span class="task-name">{{ row.taskName }}</span>
              </template>
            </el-table-column>
            <el-table-column label="进度" width="160">
              <template #default="{ row }">
                <el-progress
                  :percentage="row.progress || 0"
                  :color="getProgressColor(row.progress || 0)"
                  :stroke-width="8"
                  style="width: 110px"
                />
              </template>
            </el-table-column>
            <el-table-column label="分数" width="80" align="center">
              <template #default="{ row }">
                <span class="score" :class="{ perfect: row.score >= 100 }">
                  {{ row.score == null ? '-' : row.score }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120" align="center">
              <template #default="{ row }">
                <el-tag v-if="!row.canStart" size="small" type="danger" effect="light" round>已截止</el-tag>
                <el-tag v-else-if="row.running && row.loop" size="small" type="warning" effect="light" round>循环中</el-tag>
                <el-tag v-else-if="row.running" size="small" type="primary" effect="light" round>运行中</el-tag>
                <el-tag v-else-if="row.done" size="small" type="success" effect="light" round>已完成</el-tag>
                <el-tag v-else size="small" type="info" effect="plain" round>待执行</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="240" align="center">
              <template #default="{ row }">
                <template v-if="!row.canStart">
                  <el-tag size="small" type="danger" effect="light" round>已截止</el-tag>
                </template>
                <template v-else-if="row.running">
                  <el-button size="small" type="danger" :icon="CircleClose" round @click="stopTask(row)">停止</el-button>
                  <el-button size="small" :icon="Document" round @click="showLogs(row)">日志</el-button>
                </template>
                <template v-else>
                  <el-button size="small" type="primary" :icon="VideoPlay" round @click="startTask(row, false)">启动</el-button>
                  <el-button size="small" type="warning" :icon="RefreshRight" round @click="startTask(row, true)">循环</el-button>
                  <el-button v-if="row.done" size="small" :icon="Document" round @click="showLogs(row)">日志</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无自学任务" :image-size="60" />
        </div>
      </div>
    </div>

    <!-- 日志抽屉 -->
    <el-drawer
      v-model="logDrawerVisible"
      :title="logTitle"
      direction="rtl"
      size="50%"
      @close="closeLogs"
    >
      <div id="task-log-container" class="log-drawer-body">
        <div
          v-for="(log, idx) in logContent"
          :key="idx"
          class="log-entry"
        >
          {{ log }}
        </div>
        <div v-if="logContent.length === 0" class="log-empty">
          等待日志输出...
        </div>
      </div>
      <template #footer>
        <div class="log-drawer-footer">
          <el-tag v-if="logDone" type="success" effect="light" round>任务已结束</el-tag>
          <el-tag v-else type="primary" effect="light" round>运行中...</el-tag>
          <el-button @click="closeLogs">关闭</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.task-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 16px;
}

.task-tab__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.task-tab__status {
  font-size: 13px;
  color: #909399;
}

.task-tab__content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.task-section {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  padding: 16px;
}

.section-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.task-section__table {
  overflow: auto;
}

.task-name {
  font-weight: 500;
  color: #303133;
}

.score {
  font-weight: 600;
  color: #606266;
}

.score.perfect {
  color: #67c23a;
}

.log-drawer-body {
  height: calc(100vh - 160px);
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-entry {
  padding: 6px 12px;
  background: rgba(245, 247, 250, 0.8);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #606266;
  word-break: break-all;
}

.log-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #c0c4cc;
  font-size: 13px;
}

.log-drawer-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
