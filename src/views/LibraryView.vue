<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { bridge } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";
import PaginationBar from "@/components/PaginationBar.vue";
import type { BookListItem, PagedResult } from "@/types/api";

const router = useRouter();
const session = useSessionStore();

const serverLabel = computed(() => session.serverUrl || "尚未连接服务器");

const books = ref<BookListItem[]>([]);
const continueBooks = ref<BookListItem[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref("");
const query = ref("");
/** 经典分页状态：pageSize 按窗口大小自适应（列数 × 行数） */
const page = ref(1);
const pageSize = ref(18);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const reloading = ref(false);

// —— 动态分页：一屏固定布局 ——
// 网格区 flex 占满剩余高度，列数按宽度、行数按网格区实际高度计算，
// pageSize = 列 × 行 ⇒ 每页恰好铺满整数行（无半截行），分页栏固定在底部始终可见。

/** 与 .book-grid 的 minmax(118px, 1fr) / gap:14px 保持一致 */
const GRID_MIN_COL = 118;
const GRID_GAP = 14;

const gridAreaRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let resizeTimer = 0;

function computePageSize(): number {
  const el = gridAreaRef.value;
  if (!el || el.clientHeight < 100) return 18;
  const w = el.clientWidth;
  const cols = Math.max(3, Math.floor((w + GRID_GAP) / (GRID_MIN_COL + GRID_GAP)));
  const colW = Math.floor((w - GRID_GAP * (cols - 1)) / cols);
  // 封面 3:4 高度 + 书名/作者两行文字
  const cardH = Math.round((colW * 4) / 3) + 48;
  // 只取放得下的完整行数（floor），不足一行的空间留给底部留白
  const rows = Math.max(1, Math.floor((el.clientHeight + GRID_GAP) / (cardH + GRID_GAP)));
  return cols * rows;
}

function recalcPageSize(): void {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const next = computePageSize();
    if (next !== pageSize.value) pageSize.value = next;
  }, 180);
}

/** 每页数量变化后按当前页码重新加载（服务端会夹到有效范围）。
 *  若上一请求还在途，先记待重载标记，请求结束后补发。 */
let pendingReload = false;
watch(pageSize, (next, prev) => {
  if (next === prev || !session.authed) return;
  if (loading.value) {
    pendingReload = true;
    return;
  }
  void loadPage(page.value);
});

const PAGE_FIELDS =
  "id,name,author,category,cover_thumb_url,read_percent,read_chapter_index,read_at,chapter_count";

async function loadPage(target: number): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const params: Record<string, string | number | boolean> = {
      page: target,
      page_size: pageSize.value,
      sort: "updated",
      fields: PAGE_FIELDS,
    };
    if (query.value.trim()) params.q = query.value.trim();
    const data = await bridge.getBooks<PagedResult<BookListItem>>(params);
    books.value = data.items;
    total.value = data.total;
    page.value = data.page;
    // 翻页回到网格顶部
    gridAreaRef.value?.scrollTo({ top: 0, behavior: "auto" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "书库加载失败";
  } finally {
    loading.value = false;
    if (pendingReload) {
      pendingReload = false;
      void loadPage(page.value);
    }
  }
}

function goPage(p: number): void {
  if (p < 1 || p > totalPages.value || p === page.value || loading.value) return;
  void loadPage(p);
}

async function loadContinue(): Promise<void> {
  try {
    const data = await bridge.getBooks<PagedResult<BookListItem>>({
      read: true,
      sort: "read",
      page: 1,
      page_size: 20,
      fields: PAGE_FIELDS,
    });
    continueBooks.value = data.items;
    await nextTick();
    updateArrows();
  } catch {
    continueBooks.value = [];
  }
}

// —— 继续阅读横滑：左右箭头 + 滚轮横向滚动，无滚动条 ——

const continueRef = ref<HTMLElement | null>(null);
const canLeft = ref(false);
const canRight = ref(false);

function updateArrows(): void {
  const el = continueRef.value;
  if (!el) return;
  canLeft.value = el.scrollLeft > 4;
  canRight.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 4;
}

function slideContinue(dir: number): void {
  const el = continueRef.value;
  if (!el) return;
  el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
}

/** 纵向滚轮转横向；滑到边缘时放行页面滚动 */
function onContinueWheel(e: WheelEvent): void {
  const el = continueRef.value;
  if (!el) return;
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (d === 0) return;
  const atLeft = el.scrollLeft <= 0 && d < 0;
  const atRight = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1 && d > 0;
  if (atLeft || atRight) return;
  e.preventDefault();
  el.scrollLeft += d;
  updateArrows();
}

/** 搜索：输入防抖后走服务端 q（书名/作者），重置到第一页 */
let searchTimer = 0;
function onSearchInput(): void {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void loadPage(1), 350);
}

async function refresh(): Promise<void> {
  reloading.value = true;
  await Promise.all([loadPage(page.value), loadContinue()]);
  reloading.value = false;
}

function openBook(book: BookListItem): void {
  void router.push({ name: "book-detail", params: { id: String(book.id) } });
}

/** 继续阅读卡的章节标签：无记录返回空串 */
function chapterLabel(book: BookListItem): string {
  const idx = book.read_chapter_index ?? -1;
  if (idx < 0) return "";
  return `第 ${idx + 1}/${book.chapter_count ?? "?"} 章 · `;
}

/** 最近阅读时间：今天显示时分，今年显示月/日，更早显示年/月/日 */
function fmtReadAt(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return ` · 今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return ` · ${d.getMonth() + 1}/${d.getDate()}`;
  return ` · ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

let offLibraryRefresh: (() => void) | null = null;

onMounted(() => {
  // 先按当前布局算好每页数量，再拉首页数据
  pageSize.value = computePageSize();
  if (session.authed) void loadPage(1);
  if (session.authed) void loadContinue();
  // 阅读窗口关闭时主进程通知刷新（立即看到最新阅读进度）
  offLibraryRefresh = window.api.onLibraryRefresh(() => {
    if (session.authed) void refresh();
  });
  resizeObserver = new ResizeObserver(recalcPageSize);
  if (gridAreaRef.value) resizeObserver.observe(gridAreaRef.value);
  window.addEventListener("resize", recalcPageSize);
  window.addEventListener("resize", updateArrows);
});

onUnmounted(() => {
  offLibraryRefresh?.();
  offLibraryRefresh = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.clearTimeout(resizeTimer);
  window.removeEventListener("resize", recalcPageSize);
  window.removeEventListener("resize", updateArrows);
});
</script>

<template>
  <div class="page library-page">
    <header class="page-header library-header">
      <div>
        <h1 class="page-title">书库</h1>
        <p class="page-subtitle">
          {{ session.authed ? `${serverLabel} · 共 ${total} 本` : serverLabel }}
        </p>
      </div>
      <div class="header-actions">
        <input
          v-model="query"
          class="field-input search-input"
          placeholder="搜索书名 / 作者"
          spellcheck="false"
          @input="onSearchInput"
        />
        <button type="button" class="ghost-btn" :disabled="reloading" @click="refresh">
          {{ reloading ? "刷新中…" : "刷新" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="error-tip">{{ error }}</div>

    <!-- 继续阅读：单行横滑（箭头 + 滚轮） -->
    <section v-if="!query && continueBooks.length" class="page-card continue-card">
      <h2 class="section-title">继续阅读</h2>
      <div class="continue-strip">
        <button
          v-if="canLeft"
          type="button"
          class="strip-arrow left"
          aria-label="向左滑动"
          @click="slideContinue(-1)"
        >
          ‹
        </button>
        <div ref="continueRef" class="continue-row" @wheel="onContinueWheel" @scroll="updateArrows">
          <button
            v-for="book in continueBooks"
            :key="book.id"
            type="button"
            class="continue-item"
            @click="openBook(book)"
          >
            <span class="continue-name">{{ book.name }}</span>
            <span class="continue-meta">
              {{ chapterLabel(book) }}{{ book.read_percent ?? 0 }}%{{ fmtReadAt(book.read_at) }}
            </span>
            <span class="mini-progress">
              <span class="mini-progress-bar" :style="{ width: `${book.read_percent ?? 0}%` }" />
            </span>
          </button>
        </div>
        <button
          v-if="canRight"
          type="button"
          class="strip-arrow right"
          aria-label="向右滑动"
          @click="slideContinue(1)"
        >
          ›
        </button>
      </div>
    </section>

    <!-- 书籍网格（外层容器始终渲染且 flex 占满剩余高度，供测量列数/行数） -->
    <div ref="gridAreaRef" class="grid-area">
      <section v-if="books.length" class="book-grid">
        <button
          v-for="book in books"
          :key="book.id"
          type="button"
          class="book-card"
          @click="openBook(book)"
        >
          <span class="cover-box">
            <img
              v-if="book.cover_thumb_url"
              class="cover-img"
              :src="book.cover_thumb_url"
              :alt="book.name"
              loading="lazy"
              draggable="false"
            />
            <span v-else class="cover-fallback">{{ book.name.slice(0, 2) }}</span>
            <span v-if="(book.read_percent ?? 0) > 0" class="cover-progress">
              <span class="cover-progress-bar" :style="{ width: `${book.read_percent ?? 0}%` }" />
            </span>
          </span>
          <span class="book-name" :title="book.name">{{ book.name }}</span>
          <span class="book-meta">{{ book.author }}</span>
        </button>
      </section>

      <div v-else-if="!loading" class="empty-tip">
        {{ query ? "没有找到匹配的书籍" : "书库还是空的，先去服务器导入书籍吧" }}
      </div>

      <div v-if="loading && !books.length" class="empty-tip">加载中…</div>
    </div>

    <!-- 分页栏 -->
    <PaginationBar
      v-if="totalPages > 1"
      :page="page"
      :total-pages="totalPages"
      :loading="loading"
      :info="`共 ${total} 本 · ${totalPages} 页`"
      @go="goPage"
    />
  </div>
</template>

<style scoped>
/* 一屏固定布局：页面本身不滚动，网格区占满剩余高度，分页栏钉在底部 */
.library-page {
  height: 100%;
  gap: 12px;
  padding: 20px 32px 12px;
  overflow: hidden;
}

.library-header {
  align-items: flex-end;
}

.search-input {
  width: 200px;
  height: 30px;
}

.error-tip {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: rgba(217, 75, 75, 0.1);
  color: #c23a3a;
  font-size: 13px;
}

/* 继续阅读：单行横滑条（无滚动条，箭头 + 滚轮） */
.continue-strip {
  position: relative;
}

.continue-row {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.continue-row::-webkit-scrollbar {
  display: none;
}

.continue-item {
  flex: none;
  width: 210px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: border-color 0.15s ease;
}

.continue-item:hover {
  border-color: var(--color-accent);
}

/* 左右悬浮箭头 */
.strip-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface);
  color: var(--color-text-2);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  z-index: 5;
  display: grid;
  place-items: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  transition: border-color 0.15s ease, color 0.15s ease;
}

.strip-arrow:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.strip-arrow.left {
  left: -8px;
}

.strip-arrow.right {
  right: -8px;
}

.continue-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.continue-meta {
  font-size: 12px;
  color: var(--color-text-3);
}

.mini-progress {
  height: 3px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.mini-progress-bar {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--color-accent);
}

/* 网格区：占满剩余高度；内容超出一屏时内部滚动兜底（隐藏滚动条） */
.grid-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.grid-area::-webkit-scrollbar {
  display: none;
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 14px;
  align-content: start;
}

.book-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}

.cover-box {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-surface-2);
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
}

.cover-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #6a8bff, #4c6fff);
}

.cover-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: rgba(0, 0, 0, 0.35);
}

.cover-progress-bar {
  display: block;
  height: 100%;
  background: var(--color-accent);
}

.book-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-meta {
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: -4px;
}

.empty-tip {
  padding: 40px 0;
  text-align: center;
  color: var(--color-text-3);
  font-size: 13px;
}
</style>
