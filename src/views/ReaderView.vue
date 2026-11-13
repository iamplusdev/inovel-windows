<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { bridge } from "@/api/bridge";
import type { TocItem } from "@/types/api";
import { useReaderChapter } from "@/views/reader/useReaderChapter";
import { useReaderProgress } from "@/views/reader/useReaderProgress";
import { useReaderSettings } from "@/views/reader/useReaderSettings";
import { useReaderSources } from "@/views/reader/useReaderSources";
import { useReaderViewport } from "@/views/reader/useReaderViewport";

const route = useRoute();

const scrollRef = ref<HTMLElement | null>(null);
const toast = ref("");
const showHint = ref(false);
/** 章内滚动比例 0–1：驱动常驻进度条 */
const chapterRatio = ref(0);
/** 摸鱼：双击阅读区隐藏窗口 */
const doubleClickHide = ref(true);

/** 书籍 ID（路由 /books/:id/read） */
const bookId = ref(0);
const bookName = ref("");
/** 服务端登记为在线书（正文按需从书源抓取）才显示换源入口 */
const isOnline = ref(false);

let toastTimer = 0;
let hintTimer = 0;
let offSessionExpired: (() => void) | null = null;
let offOpenChapter: (() => void) | null = null;

function showToast(message: string) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 1800);
}

const {
  theme,
  themeOptions,
  alpha,
  fontSize,
  lineHeight,
  margin,
  fontFamily,
  settingsOpen,
  fonts,
  surfaceStyle,
  lowAlpha,
  linePx,
  loadFonts,
  persistReader,
  setTheme,
  changeFontSize,
  resetFontSize,
  applyReaderConfig,
} = useReaderSettings(showToast);

const {
  toc,
  current,
  paragraphs,
  tocOpen,
  tocFilter,
  filteredToc,
  currentIndex,
  userChoseChapter,
  externalChapterId,
  demoParagraphs,
  loadTocAll,
  openChapter,
  chooseChapter,
  prevChapter,
  nextChapter,
  toggleToc,
  invalidateChapters,
} = useReaderChapter({
  bookId,
  scrollRef,
  settingsOpen,
  chapterRatio,
  linePx,
  showToast,
  persist: () => saveProgress(true),
});

const {
  sourceOpen,
  sourceLoading,
  sourceError,
  sourceHint,
  sourceItems,
  sourceCurrent,
  switchingSource,
  openSourcePicker,
  loadSourceCandidates,
  applySource,
} = useReaderSources({
  bookId,
  bookName,
  isOnline,
  current,
  scrollRef,
  toc,
  paragraphs,
  demoParagraphs,
  settingsOpen,
  tocOpen,
  loadTocAll,
  openChapter,
  invalidateChapters,
  persist: () => saveProgress(true),
  showToast,
});

const {
  overallPercent,
  parseServerTime,
  saveProgress,
  onScroll,
  startPull,
  applySyncConfig,
  disposeProgress,
} = useReaderProgress({
  bookId,
  toc,
  current,
  currentIndex,
  paragraphs,
  scrollRef,
  chapterRatio,
  linePx,
  showToast,
  openChapter,
  userChoseChapter,
});

const { scrollByLines, onWheel, onResizeStart, onHandleDblClick } = useReaderViewport({
  scrollRef,
  linePx,
  showToast,
  doubleClickHide,
});

/** 阅读设置抽屉：打开时收起其他抽屉并按需加载字体列表 */
function toggleSettings(): void {
  settingsOpen.value = !settingsOpen.value;
  if (!settingsOpen.value) return;
  tocOpen.value = false;
  sourceOpen.value = false;
  void loadFonts();
}

/** 退出前冲刷进度 */
function flushAndExit() {
  saveProgress(true);
  void window.api.window.exitReader();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    if (sourceOpen.value) {
      sourceOpen.value = false;
      return;
    }
    if (tocOpen.value) {
      tocOpen.value = false;
      return;
    }
    if (settingsOpen.value) {
      settingsOpen.value = false;
      return;
    }
    // 独立阅读窗口：Esc 直接关闭窗口（主窗口自动恢复显示）
    flushAndExit();
    return;
  }
  // 抽屉里的输入框/滑块/下拉框自行处理按键，不触发翻页快捷键
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  const pageLines = Math.max(1, Math.floor((scrollRef.value?.clientHeight ?? 600) / linePx()));
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      scrollByLines(2);
      break;
    case "ArrowUp":
      event.preventDefault();
      scrollByLines(-2);
      break;
    case " ":
      event.preventDefault();
      scrollByLines(event.shiftKey ? -pageLines : pageLines);
      break;
    case "ArrowRight":
      event.preventDefault();
      nextChapter();
      break;
    case "ArrowLeft":
      event.preventDefault();
      prevChapter();
      break;
    case "t":
    case "T":
      if (!event.ctrlKey && !event.altKey && !event.metaKey) toggleToc();
      break;
    case "=":
    case "+":
      if (event.ctrlKey) {
        event.preventDefault();
        changeFontSize(1);
      }
      break;
    case "-":
      if (event.ctrlKey) {
        event.preventDefault();
        changeFontSize(-1);
      }
      break;
    case "0":
      if (event.ctrlKey) {
        event.preventDefault();
        resetFontSize();
      }
      break;
  }
}

onMounted(async () => {
  const config = await bridge.getSettings();
  applyReaderConfig(config.reader);
  doubleClickHide.value = config.boss.doubleClickHide;
  applySyncConfig(config.sync);

  // 会话过期（401）：直接关闭阅读窗口，主窗口会自行回到登录页
  // （双击隐藏已由主进程鼠标轮询直接处理，渲染层无需监听）
  offSessionExpired = window.api.onSessionExpired(() =>
    void window.api.window.exitReader(),
  );
  // 阅读窗口已打开时，从详情页目录点另一章：主进程直接发事件切章
  offOpenChapter = window.api.window.onOpenChapter((chapterId) => {
    const ch = toc.value.find((c) => c.id === chapterId) ?? null;
    if (ch) chooseChapter(ch);
    else externalChapterId.value = chapterId;
  });

  // 首次进入阅读模式显示一次操作提示，之后不再打扰
  if (!localStorage.getItem("inovel_reader_hint_shown")) {
    showHint.value = true;
    localStorage.setItem("inovel_reader_hint_shown", "1");
    hintTimer = window.setTimeout(() => (showHint.value = false), 5000);
  }

  window.addEventListener("keydown", onKeydown);

  // —— 加载真实书籍：目录 → 恢复进度 → 打开章节 ——
  try {
    const idNum = Number(route.params.id);
    if (Number.isFinite(idNum) && idNum > 0) {
      bookId.value = idNum;
      const [detail, localProgress] = await Promise.all([
        bridge
          .getBook<{
            name: string;
            source?: string;
            online?: boolean;
            chapter_count?: number;
            read_chapter_index?: number;
            read_at?: string;
          }>(idNum)
          .catch(() => null),
        bridge.loadLocalProgress(idNum),
      ]);
      bookName.value = detail?.name ?? "";
      isOnline.value = !!detail?.online;
      sourceCurrent.value = detail?.source ?? "";
      toc.value = await loadTocAll();

      // 起始章节：详情页目录点章 > 本地/服务端进度（显式选择优先，进度恢复兜底）
      // 注意：本页路由在 hash 内（#/books/1/read?chapter=5），query 由 vue-router 解析
      const q = route.query.chapter;
      const queryId = Number(Array.isArray(q) ? q[0] : q);
      const requestedId =
        Number.isFinite(queryId) && queryId > 0 ? queryId : externalChapterId.value;
      externalChapterId.value = 0;
      const explicit =
        requestedId > 0 ? (toc.value.find((c) => c.id === requestedId) ?? null) : null;
      let start: TocItem | null = explicit;
      let restoreRatio = 0;
      let fromServer = false;
      if (explicit) userChoseChapter.value = true;

      if (!start) {
        const localTime = localProgress?.updatedAt ? Date.parse(localProgress.updatedAt) : 0;
        const serverIndex = detail?.read_chapter_index ?? -1;
        const serverTime = parseServerTime(detail?.read_at);
        if (serverIndex >= 0 && serverTime > localTime) {
          const sc = toc.value.find((c) => c.index === serverIndex) ?? null;
          if (sc) {
            start = sc;
            fromServer = true;
          }
        }
        if (!start && localProgress) {
          if (localProgress.chapterId) {
            start = toc.value.find((c) => c.id === localProgress.chapterId) ?? null;
          }
          if (!start && localProgress.chapterIndex >= 0) {
            start = toc.value.find((c) => c.index === localProgress.chapterIndex) ?? null;
          }
          restoreRatio = localProgress.scrollRatio || 0;
        }
        if (!start) start = toc.value[0] ?? null;
      }

      if (start) {
        await openChapter(start, restoreRatio);
        if (fromServer) showToast("已同步服务器阅读进度");
        else if (restoreRatio > 0.01) showToast("已恢复上次阅读位置");
      } else {
        paragraphs.value = demoParagraphs;
        showToast("暂无章节内容");
      }

      // WebDAV 进度拉取：远端更新则跳转（用户已选章时由 startPull 内部跳过）
      startPull(localProgress);
    } else {
      paragraphs.value = demoParagraphs;
    }
  } catch (err) {
    paragraphs.value = demoParagraphs;
    showToast(err instanceof Error ? err.message : "书籍加载失败");
  }

  // 首帧就绪（设置已应用、章节已加载/兜底）：通知主进程显示窗口
  window.api.window.readerReady();
});

onUnmounted(() => {
  offSessionExpired?.();
  offSessionExpired = null;
  offOpenChapter?.();
  offOpenChapter = null;
  window.removeEventListener("keydown", onKeydown);
  window.clearTimeout(toastTimer);
  window.clearTimeout(hintTimer);
  disposeProgress();
  // 关窗前保存最终进度
  if (current.value && bookId.value) saveProgress(true);
});
</script>

<template>
  <div class="reader-page" :class="[`theme-${theme}`, { 'low-alpha': lowAlpha }]">
    <div class="surface-wrap">
      <article
        ref="scrollRef"
        class="reader-surface"
        :style="surfaceStyle"
        @wheel="onWheel"
        @scroll="onScroll"
      >
        <h1 v-if="current">{{ current.name || current.title || "正文" }}</h1>
        <h1 v-else>阅读器</h1>
        <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
        <div v-if="current" class="chapter-nav">
          <button type="button" class="nav-btn" :disabled="currentIndex <= 0" @click="prevChapter">
            上一章
          </button>
          <span class="nav-pos">{{ currentIndex + 1 }} / {{ toc.length }}</span>
          <button
            type="button"
            class="nav-btn"
            :disabled="currentIndex >= toc.length - 1"
            @click="nextChapter"
          >
            下一章
          </button>
        </div>
        <p v-else class="reader-end">按 Esc 返回</p>
      </article>

      <!-- 顶部信息条：悬浮显示 -->
      <div class="reader-topbar">
        <span class="topbar-title">{{ bookName || "iNovel" }}<template v-if="current"> · {{ current.name || current.title }}</template></span>
        <span class="topbar-percent">{{ overallPercent }}%</span>
        <button
          v-if="isOnline"
          type="button"
          class="topbar-btn"
          @click="openSourcePicker"
        >
          换源
        </button>
        <button type="button" class="topbar-btn" @click="toggleSettings">设置</button>
        <button type="button" class="topbar-btn" @click="toggleToc">目录</button>
      </div>

      <!-- 常驻退出按钮：不依赖顶栏悬浮 -->
      <button type="button" class="reader-exit" title="退出阅读（Esc）" @click="flushAndExit">
        ×
      </button>

      <!-- 目录抽屉 -->
      <transition name="slide">
        <aside v-if="tocOpen" class="toc-drawer">
          <div class="toc-head">
            <input
              v-model="tocFilter"
              type="text"
              class="toc-filter"
              placeholder="筛选章节…"
            />
            <button type="button" class="toc-close" @click="tocOpen = false">×</button>
          </div>
          <div class="toc-list">
            <button
              v-for="ch in filteredToc"
              :key="ch.id"
              type="button"
              class="toc-item"
              :class="{ 'is-current': current && ch.id === current.id }"
              @click="chooseChapter(ch)"
            >
              {{ ch.name || ch.title }}
            </button>
            <p v-if="filteredToc.length === 0" class="toc-empty">无匹配章节</p>
          </div>
        </aside>
      </transition>

      <!-- 切换书源抽屉（仅在线书） -->
      <transition name="slide">
        <aside v-if="sourceOpen" class="source-drawer">
          <div class="toc-head">
            <strong class="source-title">切换书源</strong>
            <button
              type="button"
              class="source-refresh"
              :disabled="sourceLoading || !!switchingSource"
              @click="loadSourceCandidates"
            >
              {{ sourceLoading ? "搜索中" : "重新搜索" }}
            </button>
            <button type="button" class="toc-close" @click="sourceOpen = false">×</button>
          </div>
          <div class="source-meta">
            <span>当前：{{ sourceCurrent || "未知" }}</span>
            <span v-if="sourceError" class="source-error">{{ sourceError }}</span>
            <span v-else-if="sourceHint">{{ sourceHint }}</span>
          </div>
          <div class="toc-list">
            <button
              v-for="item in sourceItems"
              :key="`${item.source_id}-${item.book_url}`"
              type="button"
              class="source-item"
              :disabled="item.current || !!switchingSource"
              @click="applySource(item)"
            >
              <span class="source-item-info">
                <span class="source-item-name">
                  {{ item.source_name || `书源 #${item.source_id}` }}
                  <em v-if="item.current" class="source-current-tag">当前</em>
                </span>
                <span v-if="item.last_chapter" class="source-item-sub">
                  最新：{{ item.last_chapter }}
                </span>
              </span>
              <span class="source-item-action">
                {{
                  item.current
                    ? "使用中"
                    : switchingSource === item.source_id
                      ? "切换中…"
                      : "切换"
                }}
              </span>
            </button>
            <p v-if="!sourceLoading && !sourceItems.length" class="toc-empty">
              {{ sourceError ? "搜索失败，可重试" : "没有找到其他书源" }}
            </p>
          </div>
        </aside>
      </transition>

      <!-- 阅读设置抽屉：参数即时生效，松手/切换时持久化 -->
      <transition name="slide">
        <aside v-if="settingsOpen" class="settings-drawer">
          <div class="toc-head">
            <strong class="source-title">阅读设置</strong>
            <button type="button" class="toc-close" @click="settingsOpen = false">×</button>
          </div>
          <div class="settings-body">
            <div class="settings-row">
              <span class="settings-label">主题</span>
              <div class="settings-themes">
                <button
                  v-for="item in themeOptions"
                  :key="item.value"
                  type="button"
                  class="settings-theme"
                  :class="{ 'is-active': theme === item.value }"
                  @click="setTheme(item.value)"
                >
                  {{ item.label }}
                </button>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">字体</span>
              <select v-model="fontFamily" class="settings-select" @change="persistReader">
                <option value="">默认（系统衬线）</option>
                <option v-for="name in fonts" :key="name" :value="name">{{ name }}</option>
              </select>
            </div>
            <div class="settings-row">
              <span class="settings-label">字号</span>
              <div class="settings-range">
                <input
                  v-model.number="fontSize"
                  type="range"
                  min="14"
                  max="28"
                  step="1"
                  @change="persistReader"
                />
                <span class="settings-value">{{ fontSize }}px</span>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">行距</span>
              <div class="settings-range">
                <input
                  v-model.number="lineHeight"
                  type="range"
                  min="1.4"
                  max="2.4"
                  step="0.1"
                  @change="persistReader"
                />
                <span class="settings-value">{{ lineHeight }}</span>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">页边距</span>
              <div class="settings-range">
                <input
                  v-model.number="margin"
                  type="range"
                  min="8"
                  max="48"
                  step="2"
                  @change="persistReader"
                />
                <span class="settings-value">{{ margin }}px</span>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">背景透明度</span>
              <div class="settings-range">
                <input
                  v-model.number="alpha"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  @change="persistReader"
                />
                <span class="settings-value">{{ Math.round(alpha * 100) }}%</span>
              </div>
            </div>
          </div>
        </aside>
      </transition>

      <!-- 常驻迷你进度条：全书百分比（悬停顶栏可看数值） -->
      <div class="reader-progress">
        <div class="reader-progress-bar" :style="{ width: `${overallPercent}%` }" />
      </div>

      <div
        class="resize-handle"
        title="拖拽调整窗口大小，双击恢复默认尺寸"
        @pointerdown="onResizeStart"
        @dblclick="onHandleDblClick"
      />
    </div>

    <transition name="fade">
      <div v-if="showHint" class="reader-hint">
        ↑↓/空格滚动 · ←→ 切章 · T 目录 · Ctrl+± 字号 · 悬停顶栏可进设置 · 双击隐藏 · Esc 退出
      </div>
    </transition>
    <transition name="fade">
      <div v-if="toast" class="reader-toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.reader-page {
  height: 100vh;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background: transparent;
  /* 原生拖拽：整个阅读区按住左键即移动窗口，由 OS 原子搬移，
     内容与边框同步运动，消除 setPosition 程序化移动的漂移/空白伪影 */
  -webkit-app-region: drag;
  cursor: default;
}

/* 正文区域外层定位容器：始终铺满窗口（缩放=改窗口尺寸，窗口边界=正文边界） */
.surface-wrap {
  position: relative;
  flex: none;
  width: 100%;
  height: 100%;
}

.reader-surface {
  height: 100%;
  overflow-y: auto;
  padding: 0 4px 0 12px;
  background: rgb(var(--reader-bg-rgb) / var(--reader-bg-alpha));
  color: #282a2f;
  font-family: "Microsoft YaHei", "PingFang SC", "HarmonyOS Sans SC", system-ui, sans-serif;
  overflow-wrap: anywhere;
  /* 摸鱼模式不显示滚动条，滚轮/快捷键滚动 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.reader-surface::-webkit-scrollbar {
  display: none;
  width: 0;
}

/* 右下角拖拽手柄：调整窗口大小（悬浮时显示） */
.resize-handle {
  -webkit-app-region: no-drag;
  position: absolute;
  right: 0;
  bottom: 0;
  width: 30px;
  height: 30px;
  cursor: nwse-resize;
  touch-action: none;
  z-index: 10;
}

.resize-handle::after {
  content: "";
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 12px;
  height: 12px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  opacity: 0;
  transition: opacity 0.15s ease;
}

/* 悬浮窗口时才显示缩放手柄，避免干扰阅读 */
.surface-wrap:hover .resize-handle::after {
  opacity: 0.6;
}

.theme-warm .reader-surface {
  color: #3b2f22;
}

.theme-night .reader-surface {
  color: #d6dbe5;
}

.reader-surface h1 {
  margin: 0 0 1.4em;
  font-size: 1.5em;
}

.reader-surface p {
  margin: 0 0 1em;
  text-indent: 2em;
}

/* 章节切换导航（文末） */
.chapter-nav {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  margin: 2em 0 1.2em;
}

.nav-btn {
  -webkit-app-region: no-drag;
  padding: 5px 14px;
  border: 1px solid currentColor;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  opacity: 0.75;
  font-size: 12px;
  cursor: pointer;
}

.nav-btn:hover:not(:disabled) {
  opacity: 1;
}

.nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.nav-pos {
  font-size: 12px;
  opacity: 0.55;
}

.reader-end {
  margin-top: 2.5em !important;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-3);
  text-indent: 0 !important;
}

/* 顶部信息条：悬浮窗口时淡入 */
.reader-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 30px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 8px 0 12px;
  opacity: 0;
  transition: opacity 0.18s ease;
  z-index: 8;
  pointer-events: none;
}

.reader-page:hover .reader-topbar {
  opacity: 0.92;
}

.topbar-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: currentColor;
  opacity: 0.65;
}

.topbar-percent {
  flex: none;
  font-size: 12px;
  opacity: 0.65;
}

.topbar-btn {
  -webkit-app-region: no-drag;
  pointer-events: auto;
  flex: none;
  padding: 3px 12px;
  border: none;
  border-radius: 999px;
  background: rgba(22, 25, 32, 0.55);
  color: #f2f4f8;
  font-size: 12px;
  cursor: pointer;
}

/* 常驻退出按钮：低透明度，悬停阅读区或按钮本身时提亮 */
.reader-exit {
  -webkit-app-region: no-drag;
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(22, 25, 32, 0.45);
  color: #f2f4f8;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.28;
  transition: opacity 0.15s ease, background 0.15s ease;
  z-index: 9;
}

.reader-page:hover .reader-exit {
  opacity: 0.85;
}

.reader-exit:hover {
  background: rgba(217, 75, 75, 0.85);
  opacity: 1;
}

/* 常驻迷你进度条 */
.reader-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgba(127, 127, 127, 0.18);
  pointer-events: none;
  z-index: 9;
}

.reader-progress-bar {
  height: 100%;
  background: #5b7cfa;
  opacity: 0.75;
  transition: width 0.15s ease;
}

/* 目录抽屉 */
.toc-drawer {
  -webkit-app-region: no-drag;
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(320px, 85%);
  display: flex;
  flex-direction: column;
  background: rgba(24, 27, 34, 0.94);
  color: #e8ebf2;
  z-index: 15;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.35);
}

.toc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.toc-filter {
  flex: 1;
  height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font-size: 12px;
  outline: none;
}

.toc-filter:focus {
  border-color: rgba(255, 255, 255, 0.35);
}

.toc-close {
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
}

.toc-close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.toc-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.toc-item {
  display: block;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  font-size: 13px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc-item:hover {
  background: rgba(255, 255, 255, 0.07);
}

.toc-item.is-current {
  color: #7cb8ff;
  background: rgba(88, 152, 255, 0.12);
}

.toc-empty {
  padding: 20px;
  text-align: center;
  font-size: 12px;
  opacity: 0.5;
}

/* 换源抽屉：与目录同款外观，避免小窗口里再叠弹窗 */
.source-drawer {
  -webkit-app-region: no-drag;
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(320px, 90%);
  display: flex;
  flex-direction: column;
  background: rgba(24, 27, 34, 0.96);
  color: #e8ebf2;
  z-index: 16;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.35);
}

.source-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
}

.source-refresh {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.source-refresh:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.source-refresh:disabled {
  opacity: 0.55;
  cursor: default;
}

.source-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
  opacity: 0.75;
}

.source-meta .source-error {
  color: #ff8a8a;
  opacity: 1;
}

.source-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 14px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.source-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.07);
}

.source-item:disabled {
  cursor: default;
}

.source-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.source-item-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-current-tag {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(88, 152, 255, 0.18);
  color: #7cb8ff;
  font-size: 10px;
  font-style: normal;
}

.source-item-sub {
  font-size: 11px;
  opacity: 0.55;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-item-action {
  flex: none;
  font-size: 12px;
  color: #7cb8ff;
}

.source-item:disabled .source-item-action {
  color: inherit;
  opacity: 0.45;
}

/* 阅读设置抽屉：与目录/换源同款暗色外观 */
.settings-drawer {
  -webkit-app-region: no-drag;
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(300px, 88%);
  display: flex;
  flex-direction: column;
  background: rgba(24, 27, 34, 0.96);
  color: #e8ebf2;
  z-index: 17;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.35);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-row {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.settings-label {
  font-size: 12px;
  opacity: 0.7;
}

.settings-themes {
  display: flex;
  gap: 6px;
}

.settings-theme {
  flex: 1;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.settings-theme:hover {
  background: rgba(255, 255, 255, 0.12);
}

.settings-theme.is-active {
  border-color: #7cb8ff;
  background: rgba(88, 152, 255, 0.16);
  color: #9cc8ff;
}

.settings-select {
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font-size: 12px;
  outline: none;
}

.settings-select option {
  background: #1b1f27;
  color: #e8ebf2;
}

.settings-range {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-range input[type="range"] {
  flex: 1;
  min-width: 0;
  accent-color: #7cb8ff;
}

.settings-value {
  flex: none;
  min-width: 38px;
  text-align: right;
  font-size: 12px;
  opacity: 0.75;
}

/* 目录抽屉动画：右侧滑入 */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

.reader-toast,
.reader-hint {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  padding: 7px 16px;
  border-radius: 999px;
  background: rgba(22, 25, 32, 0.78);
  color: #f2f4f8;
  font-size: 12px;
  white-space: nowrap;
  z-index: 20;
  pointer-events: none;
}

.reader-toast {
  bottom: 30px;
}

.reader-hint {
  top: 20px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
