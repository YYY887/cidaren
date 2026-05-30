<script setup lang="ts">
/**
 * 词达人助手 - 根组件
 * Tab 导航 + 组件路由
 */
import { ref } from 'vue'
import {
  List,
  QuestionFilled,
  Setting,
} from '@element-plus/icons-vue'
import CaptureTab from './components/CaptureTab.vue'
import TaskTab from './components/TaskTab.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import appIcon from './assets/icon.png'

// ── 状态 ──

const activeTab = ref('capture')
const settingsVisible = ref(false)
const tutorialVisible = ref(false)

// ── 方法 ──

function handleTabChange(tab: string) {
  if (tab === 'settings') {
    settingsVisible.value = true
    // Reset to previous tab since settings is a dialog
    activeTab.value = activeTab.value === 'settings' ? 'capture' : activeTab.value
    return
  }
  activeTab.value = tab
}

function showTutorial() {
  tutorialVisible.value = true
}

function handleTokensCaptured(tokens: { usertoken: string; abc: string; authV: string }) {
  // Auto-save captured tokens to config
  window.cidaren.saveConfig({
    USERTOKEN: tokens.usertoken,
    ABC: tokens.abc,
    AUTH_V: tokens.authV,
  })
}

function handleTokenExpired() {
  // 自动切换到抓包页面
  activeTab.value = 'capture'
}

function handleSettingsSaved() {
  // Could refresh tasks or other state here
}
</script>

<template>
  <div class="app-layout">
    <!-- Header -->
    <header class="app-header">
      <div class="app-header__left">
        <img class="app-logo" :src="appIcon" alt="词达人助手" />
        <h1 class="app-title">词达人助手</h1>
        <span class="app-version">v1.0.0</span>
      </div>
      <nav class="app-nav">
        <button
          class="nav-btn"
          :class="{ active: activeTab === 'capture' }"
          @click="handleTabChange('capture')"
        >
          <img class="nav-icon" :src="appIcon" alt="" />
          抓包
        </button>
        <button
          class="nav-btn"
          :class="{ active: activeTab === 'tasks' }"
          @click="handleTabChange('tasks')"
        >
          <el-icon><List /></el-icon>
          任务
        </button>
        <button
          class="nav-btn nav-btn--tutorial"
          @click="showTutorial"
        >
          <el-icon><QuestionFilled /></el-icon>
          教程
        </button>
        <button
          class="nav-btn"
          @click="handleTabChange('settings')"
        >
          <el-icon><Setting /></el-icon>
          设置
        </button>
      </nav>
    </header>

    <!-- Main Content -->
    <main class="app-main">
      <CaptureTab
        v-show="activeTab === 'capture'"
        @tokens-captured="handleTokensCaptured"
      />
      <TaskTab
        v-show="activeTab === 'tasks'"
        @token-expired="handleTokenExpired"
      />
    </main>

    <!-- Settings Drawer -->
    <SettingsDialog
      v-model:visible="settingsVisible"
      @saved="handleSettingsSaved"
    />

    <!-- Tutorial Dialog -->
    <el-dialog
      v-model="tutorialVisible"
      title="使用教程"
      width="560px"
      align-center
    >
      <div class="tutorial-content">
        <div class="tutorial-step">
          <div class="tutorial-step__index">1</div>
          <div>
            <h3>先配置模型</h3>
            <p>点击右上角 <strong>设置</strong>，填写模型接口地址、Key 和模型名称，然后可以先测试连接是否正常。</p>
          </div>
        </div>
        <div class="tutorial-step">
          <div class="tutorial-step__index">2</div>
          <div>
            <h3>进入词达人并确认已登录</h3>
            <p>抓包前请先打开词达人页面，确保账号已经登录成功，并能正常进入学生首页。</p>
          </div>
        </div>
        <div class="tutorial-step">
          <div class="tutorial-step__index">3</div>
          <div>
            <h3>开始抓包并刷新页面</h3>
            <p>回到本工具点击 <strong>开始抓包</strong>，然后刷新词达人页面。捕获成功后会自动保存 Token，并弹出成功提示。</p>
          </div>
        </div>
        <div class="tutorial-tip">
          <strong>提示：</strong>捕获成功时会播放提示音。如果一直没有成功，请确认词达人已登录、系统代理已生效，必要时重新启动抓包后再刷新页面。
        </div>
      </div>
      <template #footer>
        <el-button @click="settingsVisible = true; tutorialVisible = false">去设置模型</el-button>
        <el-button type="primary" @click="tutorialVisible = false">我知道了</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style>
/* Global styles */
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans SC', sans-serif;
  background: #f0f2f5;
}

#app {
  height: 100%;
}

/* Override Element Plus defaults for cleaner look */
.el-button.is-round {
  border-radius: 20px;
}

code {
  background: #f2f4f7;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}
</style>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}

.app-header__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.app-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  object-fit: cover;
}

.app-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #303133;
  letter-spacing: -0.3px;
}

.app-version {
  font-size: 11px;
  color: #c0c4cc;
  background: #f5f7fa;
  padding: 2px 8px;
  border-radius: 10px;
}

.app-nav {
  display: flex;
  gap: 4px;
}

.nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #606266;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-btn:hover {
  background: #f5f7fa;
  color: #409eff;
}

.nav-btn.active {
  background: #ecf5ff;
  color: #409eff;
}

.nav-icon {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  object-fit: cover;
}

.nav-btn--tutorial {
  color: #e6a23c;
}

.nav-btn--tutorial:hover {
  background: #fdf6ec;
  color: #e6a23c;
}

.app-main {
  flex: 1;
  padding: 20px 24px;
  overflow: hidden;
}

.tutorial-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tutorial-step {
  display: flex;
  gap: 12px;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid #edf2f7;
  border-radius: 12px;
}

.tutorial-step__index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #409eff;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}

.tutorial-step h3 {
  margin: 0 0 6px;
  font-size: 14px;
  color: #303133;
}

.tutorial-step p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #606266;
}

.tutorial-tip {
  padding: 12px 14px;
  border-radius: 10px;
  background: #fdf6ec;
  color: #a16207;
  font-size: 13px;
  line-height: 1.7;
}
</style>
