<script setup lang="ts">
/**
 * LogPanel - 可复用的日志显示组件
 * 每条日志以独立的半透明圆角块展示，自动滚动到底部
 */
import { ref, watch, nextTick } from 'vue'
import { Delete } from '@element-plus/icons-vue'

const props = withDefaults(defineProps<{
  logs: string[]
  title?: string
  clearable?: boolean
}>(), {
  title: '运行日志',
  clearable: true,
})

const emit = defineEmits<{
  clear: []
}>()

const scrollContainer = ref<HTMLElement | null>(null)

watch(
  () => props.logs.length,
  async () => {
    await nextTick()
    if (scrollContainer.value) {
      const el = scrollContainer.value
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight
      }
    }
  }
)

function handleClear() {
  emit('clear')
}
</script>

<template>
  <div class="log-panel">
    <div class="log-panel__header">
      <span class="log-panel__title">
        <el-icon><Document /></el-icon>
        {{ title }}
      </span>
      <el-button
        v-if="clearable"
        size="small"
        text
        :icon="Delete"
        @click="handleClear"
      >
        清空
      </el-button>
    </div>
    <div ref="scrollContainer" class="log-panel__body">
      <div v-if="logs.length === 0" class="log-panel__empty">
        暂无日志
      </div>
      <div
        v-for="(log, idx) in logs"
        :key="idx"
        class="log-panel__entry"
      >
        {{ log }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 200px;
}

.log-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.log-panel__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.log-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-panel__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #c0c4cc;
  font-size: 13px;
}

.log-panel__entry {
  padding: 6px 12px;
  background: rgba(245, 247, 250, 0.8);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #606266;
  word-break: break-all;
  transition: background 0.2s;
}

.log-panel__entry:hover {
  background: rgba(236, 239, 244, 0.9);
}
</style>
