<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { UpdateInfoShape, UpdateProgressShape } from "@/types/global";

/** 全局更新弹窗：启动自动检查发现新版时由主进程广播 update:available 触发 */
const visible = ref(false);
const info = ref<UpdateInfoShape | null>(null);
const currentVersion = ref("");
const downloading = ref(false);
const percent = ref(0);
const error = ref("");

let offAvailable: (() => void) | null = null;
let offProgress: (() => void) | null = null;
let offError: (() => void) | null = null;

onMounted(() => {
  void window.api.app.version().then((v) => (currentVersion.value = v));
  offAvailable = window.api.update.onAvailable((payload) => {
    if (downloading.value) return;
    info.value = payload;
    error.value = "";
    visible.value = true;
  });
  offProgress = window.api.update.onProgress((p: UpdateProgressShape) => {
    percent.value = p.percent >= 0 ? p.percent : 0;
  });
  offError = window.api.update.onError((message) => {
    error.value = message;
  });
});
onUnmounted(() => {
  offAvailable?.();
  offProgress?.();
  offError?.();
});

async function startUpdate(): Promise<void> {
  if (!info.value) return;
  downloading.value = true;
  error.value = "";
  percent.value = 0;
  const result = await window.api.update.download();
  if (!result.ok) {
    error.value = result.error ?? "下载失败";
    downloading.value = false;
    return;
  }
  // 下载完成由主进程弹原生对话框（立即运行/打开位置/稍后），这里收起弹窗
  visible.value = false;
  downloading.value = false;
}

/** 暂不更新：记住该版本，不再弹窗；更新版本仍会提醒 */
async function later(): Promise<void> {
  if (info.value) void window.api.update.ignoreVersion(info.value.version);
  visible.value = false;
}

const notesText = (): string => (info.value?.notes ?? "").trim() || "本版本没有填写更新说明。";
const sizeText = (): string => {
  const size = info.value?.asset.size ?? 0;
  return size > 0 ? `${(size / 1024 / 1024).toFixed(1)} MB` : "";
};
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && info" class="update-mask">
      <div class="update-card">
        <header class="update-head">
          <h3 class="update-title">发现新版本</h3>
          <button
            type="button"
            class="close-btn"
            :disabled="downloading"
            aria-label="关闭"
            @click="later"
          >
            ×
          </button>
        </header>

        <p class="update-versions">
          <strong>v{{ info.version }}</strong>
          <span class="muted">（当前 v{{ currentVersion }}）</span>
          <span v-if="sizeText" class="muted"> · {{ sizeText() }}</span>
        </p>

        <div class="update-notes">
          <pre>{{ notesText() }}</pre>
        </div>

        <p v-if="error" class="update-error">{{ error }}</p>

        <template v-if="downloading">
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${percent}%` }"></div>
          </div>
          <p class="muted progress-text">下载中 {{ percent }}%（完成后会询问是否运行）</p>
        </template>

        <footer class="update-actions">
          <button
            type="button"
            class="primary-btn"
            :disabled="downloading"
            @click="startUpdate"
          >
            {{ downloading ? "下载中…" : "立即更新" }}
          </button>
          <button type="button" class="ghost-btn" :disabled="downloading" @click="later">
            暂不更新
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.update-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 35%);
}

.update-card {
  width: 420px;
  max-width: calc(100vw - 48px);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  border-radius: var(--radius-lg, 12px);
  background: var(--color-surface);
  box-shadow: 0 12px 40px rgb(0 0 0 / 25%);
}

.update-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.update-title {
  margin: 0;
  font-size: 16px;
  color: var(--color-text);
}

.close-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--color-text-3);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.close-btn:hover:not(:disabled) {
  background: var(--color-surface-2);
}

.update-versions {
  margin: 0;
  font-size: 14px;
  color: var(--color-text);
}

.muted {
  color: var(--color-text-3);
  font-size: 12px;
}

.update-notes {
  flex: 1;
  min-height: 0;
  max-height: 220px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 8px);
  background: var(--color-surface-2);
}

.update-notes pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-2);
}

.update-error {
  margin: 0;
  color: #d54941;
  font-size: 13px;
}

.progress-track {
  height: 6px;
  border-radius: 3px;
  background: var(--color-surface-2);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--color-accent);
  transition: width 0.3s ease;
}

.progress-text {
  margin: 0;
}

.update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

