<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { bridge } from "@/api/bridge";
import type { TocItem } from "@/types/api";

const route = useRoute();

const theme = ref<"paper" | "warm" | "night">("paper");
const alpha = ref(0.9);
/** 字体不透明度 0–1（只作用于文字颜色） */
const textAlpha = ref(1);
const fontSize = ref(19);
const lineHeight = ref(1.9);
/** 正文字体族名（空串=系统默认衬线）与字体颜色（空串=主题默认） */
const fontFamily = ref("");
const fontColor = ref("");
/** 摸鱼：双击阅读区隐藏窗口 */
const doubleClickHide = ref(true);

const scrollRef = ref<HTMLElement | null>(null);
const toast = ref("");
const showHint = ref(false);
let toastTimer = 0;
let hintTimer = 0;
let offSessionExpired: (() => void) | null = null;

// —— 真实章节状态 ——

/** 书籍 ID（路由 /books/:id/read） */
const bookId = ref(0);
const bookName = ref("");
/** 完整目录（分页拉全） */
const toc = ref<TocItem[]>([]);
/** 当前章节 */
const current = ref<TocItem | null>(null);
/** 章节正文段落 */
const paragraphs = ref<string[]>([]);
const chapterLoading = ref(false);
/** 目录抽屉 */
const tocOpen = ref(false);
const tocFilter = ref("");
const filteredToc = computed(() => {
  const kw = tocFilter.value.trim().toLowerCase();
  if (!kw) return toc.value;
  return toc.value.filter((c) => (c.name || c.title || "").toLowerCase().includes(kw));
});

const themeRgb: Record<string, string> = {
  paper: "247 245 240",
  warm: "243 231 211",
  night: "18 22 28",
};

/** 各主题默认文字色（自定义 fontColor 优先） */
const themeTextColor: Record<string, string> = {
  paper: "#282a2f",
  warm: "#3b2f22",
  night: "#d6dbe5",
};

/** #rrggbb → rgba(含透明度)；无法解析时原样返回 */
function withAlpha(hex: string, a: number): string {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** 最终文字颜色 = 自定义颜色/主题默认色 + 字体透明度 */
const textColor = computed(() => {
  const base = fontColor.value || themeTextColor[theme.value] || themeTextColor.paper;
  const a = Math.min(1, Math.max(0.05, textAlpha.value));
  return withAlpha(base, a);
});

const surfaceStyle = computed(() => ({
  "--reader-bg-rgb": themeRgb[theme.value] || themeRgb.paper,
  "--reader-bg-alpha": String(Math.min(1, Math.max(0, alpha.value))),
  fontSize: `${fontSize.value}px`,
  lineHeight: String(lineHeight.value),
  fontFamily: fontFamily.value
    ? `"${fontFamily.value}", "Microsoft YaHei", system-ui, sans-serif`
    : undefined,
  color: textColor.value,
}));

const lowAlpha = computed(() => alpha.value < 0.3);

/** 骨架示例（无 bookId 时兜底展示） */
const demoParagraphs = [
  "这是 iNovel 的阅读器骨架，用于验证无边框窗口、沉浸阅读和正文背景透明度。",
  "打开书库选择一本书即可阅读真实章节内容。",
];

function showToast(message: string) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 1800);
}

/** 一行文字的实际像素高度（滚动按整行对齐） */
function linePx(): number {
  return Math.max(1, fontSize.value * lineHeight.value);
}

/** 按整行滚动：目标位置对齐到行网格，正文不会停在半行 */
function scrollByLines(lines: number) {
  const el = scrollRef.value;
  if (!el || lines === 0) return;
  const lpx = linePx();
  const max = el.scrollHeight - el.clientHeight;
  const target = Math.round(el.scrollTop / lpx) * lpx + lines * lpx;
  el.scrollTop = Math.max(0, Math.min(max, target));
}

/** 滚轮：累积增量凑整行（drag 区滚轮由主进程注入而来） */
let wheelAcc = 0;
function onWheel(e: WheelEvent) {
  e.preventDefault();
  const lpx = linePx();
  wheelAcc += e.deltaY;
  const lines = Math.trunc(wheelAcc / lpx);
  if (lines !== 0) {
    wheelAcc -= lines * lpx;
    scrollByLines(lines);
  }
}

function changeFontSize(delta: number) {
  const next = Math.min(28, Math.max(14, fontSize.value + delta));
  if (next === fontSize.value) return;
  fontSize.value = next;
  void bridge.setSettings({ reader: { fontSize: next } });
  showToast(`字号 ${next}px`);
}

// —— 目录与章节加载 ——

/** 分页拉全目录（500/页，40 页保护） */
async function loadTocAll(): Promise<TocItem[]> {
  const all: TocItem[] = [];
  for (let page = 1; page <= 40; page++) {
    const resp = await bridge.getToc<{ items: TocItem[]; total: number }>(bookId.value, page);
    all.push(...(resp.items ?? []));
    if (all.length >= (resp.total ?? 0) || (resp.items ?? []).length === 0) break;
  }
  return all;
}

/** 当前章在目录中的序号 */
const currentIndex = computed(() => {
  if (!current.value) return -1;
  return toc.value.findIndex((c) => c.id === current.value!.id);
});

/** 打开指定章节；restoreRatio 为章内滚动恢复比例 */
async function openChapter(ch: TocItem, restoreRatio = 0) {
  if (chapterLoading.value) return;
  chapterLoading.value = true;
  try {
    const data = await bridge.getChapter<{ content: string }>(bookId.value, ch.id);
    current.value = ch;
    const text = String(data.content ?? "");
    paragraphs.value = text
      .split(/\r?\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    tocOpen.value = false;
    await nextTick();
    // 恢复章内滚动位置（对齐行网格）
    const el = scrollRef.value;
    if (el) {
      const lpx = linePx();
      const max = el.scrollHeight - el.clientHeight;
      const target = Math.round(restoreRatio * max / lpx) * lpx;
      el.scrollTop = Math.max(0, Math.min(max, target));
    }
    // 切章是关键节点：立即写本地 + 服务端 + 推 Legado
    saveProgress(true);
  } catch (err) {
    showToast(err instanceof Error ? err.message : "章节加载失败");
  } finally {
    chapterLoading.value = false;
  }
}

function prevChapter() {
  const i = currentIndex.value;
  if (i <= 0) {
    showToast("已经是第一章");
    return;
  }
  void openChapter(toc.value[i - 1]);
}

function nextChapter() {
  const i = currentIndex.value;
  if (i < 0 || i >= toc.value.length - 1) {
    showToast("已经是最后一章");
    return;
  }
  void openChapter(toc.value[i + 1]);
}

function toggleToc() {
  tocOpen.value = !tocOpen.value;
  if (tocOpen.value) tocFilter.value = "";
}

// —— 进度保存与恢复 ——

/** 同步开关（服务端 DB + Legado WebDAV） */
const syncToServer = ref(true);
const syncToLegado = ref(true);
/** 服务端未配置 WebDAV 时只提示一次，不弹错误 */
let webdavMissingHinted = false;

/** 进度百分比：按章节位置 + 章内滚动比例折算（读至第 i 章顶部≈i/total，章末=100% 更平滑） */
function progressPercent(ratio = 0): number {
  const total = toc.value.length;
  const i = currentIndex.value;
  if (total <= 0 || i < 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((i + ratio) / total) * 100)));
}

/**
 * 解析服务端时间。服务端存本地时区（UTC+8）无时区标记的 naive 时间，
 * 客户端无法确知其时区：取「按本地/按 UTC」两种解读中不晚于当前时间的最大者
 * （真实发生时间不可能在未来，故可排除错误解读导致的 8 小时偏移）。
 */
function parseServerTime(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  if (/[Zz]$/.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso)) return t;
  const asLocal = t;
  const asUtc = t + new Date().getTimezoneOffset() * 60000;
  const now = Date.now() + 120000; // 2 分钟时钟误差容忍
  const valid = [asLocal, asUtc].filter((v) => v <= now);
  return valid.length ? Math.max(...valid) : Math.min(asLocal, asUtc);
}

/** 当前章总字符数（估算 chapterPos 用） */
const chapterChars = computed(() => paragraphs.value.reduce((n, p) => n + p.length, 0));

let localSaveTimer = 0;
let serverSaveAt = 0;
let legadoPushAt = 0;
/** 服务端写回失败只提示一次，避免阅读时频繁打扰 */
let serverSyncErrorHinted = false;

/** 推送进度到 WebDAV（经服务端 /sync/push 后台写入，最新者胜）；失败静默 */
function pushLegado(ch: TocItem, chapterPos: number): void {
  if (!syncToLegado.value) return;
  void bridge
    .pushLegadoProgress(bookId.value, {
      chapter_id: ch.id,
      chapter_pos: chapterPos,
      client_time: Date.now(),
    })
    .catch(() => {
      // 推送失败不阻塞阅读；下一次切章/停止滚动时重试
    });
}

/** 保存进度；immediate=false 时走防抖（本地 700ms，Legado 10 秒） */
function saveProgress(immediate = true) {
  const ch = current.value;
  if (!ch || !bookId.value) return;
  const el = scrollRef.value;
  const max = el ? Math.max(1, el.scrollHeight - el.clientHeight) : 1;
  const ratio = el ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
  const payload = {
    bookId: bookId.value,
    chapterId: ch.id,
    chapterIndex: ch.index,
    scrollRatio: ratio,
    chapterPos: Math.round(ratio * chapterChars.value),
    percent: progressPercent(ratio),
    updatedAt: new Date().toISOString(),
  };
  const doSave = (force: boolean) => {
    void bridge.saveLocalProgress(payload);
    // 服务端 DB 写回节流：15 秒内不重复（切章/关窗 force 立即写）
    const now = Date.now();
    if (syncToServer.value && (force || now - serverSaveAt > 15000)) {
      serverSaveAt = now;
      bridge
        .saveProgress(bookId.value, {
          percent: payload.percent,
          chapter_index: ch.index,
        })
        .catch((err) => {
          // 失败不阻塞阅读，但要让人知道（本地进度已保存，下次成功后会覆盖服务端）
          if (!serverSyncErrorHinted) {
            serverSyncErrorHinted = true;
            showToast(
              `进度同步失败：${err instanceof Error ? err.message : "未知错误"}（本地已保存）`,
            );
          }
        });
    }
    // Legado WebDAV 推送：切章/关窗立即推；滚动停止约 10 秒推
    if (force || now - legadoPushAt > 10000) {
      legadoPushAt = now;
      pushLegado(ch, payload.chapterPos);
    }
  };
  window.clearTimeout(localSaveTimer);
  if (immediate) {
    doSave(true);
  } else {
    localSaveTimer = window.setTimeout(() => doSave(false), 700);
  }
}

/** 滚动时防抖保存（滚轮注入/键盘滚动都会触发 scroll 事件） */
function onScroll() {
  if (current.value) saveProgress(false);
}

/** 退出前冲刷进度 */
function flushAndExit() {
  saveProgress(true);
  void window.api.window.exitReader();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    if (tocOpen.value) {
      tocOpen.value = false;
      return;
    }
    // 独立阅读窗口：Esc 直接关闭窗口（主窗口自动恢复显示）
    flushAndExit();
    return;
  }
  // 目录抽屉打开时输入框需要正常键入
  if (tocOpen.value && event.target instanceof HTMLInputElement) return;
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
        fontSize.value = 19;
        void bridge.setSettings({ reader: { fontSize: 19 } });
        showToast("字号 19px");
      }
      break;
  }
}

/** 摸鱼：双击瞬间隐藏窗口（主进程鼠标轮询判定，找回 = 托盘图标或老板键） */
function onCaptionDblClick(): void {
  if (!doubleClickHide.value) return;
  void window.api.boss.hide();
}

/** 拖拽右下角手柄：直接缩放阅读窗口本身（窗口边界=正文边界，无内部空白） */
const READER_DEFAULT = { width: 480, height: 720 };

function onResizeStart(event: PointerEvent) {
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startY = event.clientY;
  const startW = window.innerWidth;
  const startH = window.innerHeight;
  let pending = false;
  let nextW = startW;
  let nextH = startH;

  const apply = () => {
    pending = false;
    // 高度对齐整行网格：窗口高度=行高整数倍，底部不出现半行
    const lpx = linePx();
    const snappedH = Math.round(nextH / lpx) * lpx;
    void window.api.window.readerResize(nextW, Math.max(lpx * 3, snappedH));
  };

  const onMove = (e: PointerEvent) => {
    nextW = startW + (e.clientX - startX);
    nextH = startH + (e.clientY - startY);
    if (!pending) {
      pending = true;
      requestAnimationFrame(apply);
    }
  };
  const onUp = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
}

/** 双击手柄：恢复默认阅读窗口尺寸（高度同样对齐整行） */
function onHandleDblClick(event: MouseEvent) {
  event.stopPropagation();
  const lpx = linePx();
  void window.api.window.readerResize(
    READER_DEFAULT.width,
    Math.round(READER_DEFAULT.height / lpx) * lpx,
  );
  showToast("已恢复默认窗口大小");
}

onMounted(async () => {
  const config = await bridge.getSettings();
  theme.value = config.reader.theme;
  alpha.value = config.reader.bgAlpha;
  textAlpha.value = config.reader.textAlpha ?? 1;
  fontSize.value = config.reader.fontSize;
  lineHeight.value = config.reader.lineHeight;
  fontFamily.value = config.reader.fontFamily === "system" ? "" : config.reader.fontFamily || "";
  fontColor.value = config.reader.fontColor || "";
  doubleClickHide.value = config.boss.doubleClickHide;
  syncToServer.value = config.sync.toServer !== false;
  syncToLegado.value = config.sync.toLegado !== false;

  // 会话过期（401）：直接关闭阅读窗口，主窗口会自行回到登录页
  // （双击隐藏已由主进程鼠标轮询直接处理，渲染层无需监听）
  offSessionExpired = window.api.onSessionExpired(() =>
    void window.api.window.exitReader(),
  );

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
            chapter_count?: number;
            read_chapter_index?: number;
            read_at?: string;
          }>(idNum)
          .catch(() => null),
        bridge.loadLocalProgress(idNum),
      ]);
      bookName.value = detail?.name ?? "";
      toc.value = await loadTocAll();

      // 起始章节：本地进度与服务端进度取较新者（服务端跨设备/重装后仍可恢复）
      let start: TocItem | null = null;
      let restoreRatio = 0;
      let fromServer = false;
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

      if (start) {
        await openChapter(start, restoreRatio);
        if (fromServer) showToast("已同步服务器阅读进度");
        else if (restoreRatio > 0.01) showToast("已恢复上次阅读位置");
      } else {
        paragraphs.value = demoParagraphs;
        showToast("暂无章节内容");
      }

      // —— WebDAV 进度拉取：服务端对比远端后写回 DB；远端更新则跳转（最新者胜） ——
      if (syncToLegado.value && toc.value.length > 0) {
        void (async () => {
          try {
            const resp = await bridge.pullLegadoProgress(bookId.value);
            const r = resp as {
              enabled?: boolean;
              updated?: boolean;
              chapter_id?: number;
              chapter_pos?: number;
              remote_time?: number;
            };
            if (r?.enabled === false && !webdavMissingHinted) {
              webdavMissingHinted = true;
              showToast("服务端未启用 WebDAV，阅读进度不与 Legado 同步");
              return;
            }
            if (!r?.updated || !current.value) return;
            // 本地进度可能比服务端 DB 还新（离线阅读过）：仍以最新者为准
            const localMs = localProgress?.updatedAt
              ? Date.parse(localProgress.updatedAt)
              : 0;
            const remoteMs = r.remote_time || 0;
            if (remoteMs && localMs && remoteMs <= localMs) return;
            const target = toc.value.find((c) => c.id === r.chapter_id) ?? null;
            if (!target) return;
            const sameChapter = target.id === current.value?.id;
            if (!sameChapter) await openChapter(target, 0);
            // 章内字符位置 → 行对齐滚动
            const el = scrollRef.value;
            if (el && (r.chapter_pos || 0) > 0) {
              const per = Math.max(1, chapterChars.value);
              const ratio = Math.min(1, (r.chapter_pos || 0) / per);
              const lpx = linePx();
              const max = Math.max(1, el.scrollHeight - el.clientHeight);
              el.scrollTop = Math.round((ratio * max) / lpx) * lpx;
            }
            showToast("已同步 WebDAV 最新阅读进度");
          } catch {
            // 拉取失败不打扰阅读
          }
        })();
      }
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
  window.removeEventListener("keydown", onKeydown);
  window.clearTimeout(toastTimer);
  window.clearTimeout(hintTimer);
  window.clearTimeout(localSaveTimer);
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
        <button type="button" class="topbar-btn" @click="toggleToc">目录</button>
      </div>

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
              @click="openChapter(ch)"
            >
              {{ ch.name || ch.title }}
            </button>
            <p v-if="filteredToc.length === 0" class="toc-empty">无匹配章节</p>
          </div>
        </aside>
      </transition>

      <div
        class="resize-handle"
        title="拖拽调整窗口大小，双击恢复默认尺寸"
        @pointerdown="onResizeStart"
        @dblclick="onHandleDblClick"
      />
    </div>

    <transition name="fade">
      <div v-if="showHint" class="reader-hint">
        ↑↓/空格滚动 · ←→ 切章 · T 目录 · 按住左键拖动窗口 · 双击隐藏 · 右下角调大小 · Esc 退出
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
