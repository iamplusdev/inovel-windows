<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { bridge } from "@/api/bridge";
import type { ProgressUpdatedBook } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";
import PaginationBar from "@/components/PaginationBar.vue";
import ContinueReadingStrip from "@/components/library/ContinueReadingStrip.vue";
import LibraryBookGrid from "@/components/library/LibraryBookGrid.vue";
import LibraryFilterBar from "@/components/library/LibraryFilterBar.vue";
import OnlineBookModal from "@/components/library/OnlineBookModal.vue";
import type { BookFacets, BookListItem, PagedResult } from "@/types/api";

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
 *  若上一请求还在途，先记下待加载页码，请求结束后补发。 */
let pendingPage: number | null = null;
watch(pageSize, (next, prev) => {
  if (next === prev || !session.authed) return;
  if (loading.value) {
    pendingPage = page.value;
    return;
  }
  void loadPage(page.value);
});

const PAGE_FIELDS = [
  "id,name,author,category,cover_thumb_url,cover_url,read_percent,read_chapter_index",
  "read_at,chapter_count,origin,readable,shelf_id,source_name,book_url,latest_chapter",
  "dur_chapter_title,intro,full_intro,status",
].join(",");

/** 书架来源筛选：all=合并书架（本地 + Legado 同步）/ 三部分单独看 */
const origin = ref("all");
/** 合并书架的三部分计数（老服务端没有该字段，不显示） */
const originCounts = ref<Record<string, number> | null>(null);

// —— 分类 / 书源 / 排序 ——
const facets = ref<BookFacets>({ categories: [], sources: [] });
const category = ref("");
const source = ref("");
const sort = ref("updated");

const hasActiveFilters = computed(
  () =>
    origin.value !== "all" ||
    category.value !== "" ||
    source.value !== "" ||
    sort.value !== "updated",
);

/** 筛选候选只在进入书库与手动刷新时拉取；老服务端失败则下拉只留「全部」 */
async function loadFacets(): Promise<void> {
  if (!session.authed) return;
  try {
    facets.value = await bridge.getBookFacets<BookFacets>();
  } catch {
    facets.value = { categories: [], sources: [] };
  }
}

/** 仅 Legado 的在线书：服务端没有正文，点开只展示信息 */
const onlineBook = ref<BookListItem | null>(null);

/** 老服务端不支持合并书架时不给来源筛选，避免选了「仅手机在线」却显示本地书 */
const originSupported = ref(true);

function applyFilters(): void {
  page.value = 1;
  if (session.authed) void loadPage(1);
}

function resetFilters(): void {
  origin.value = "all";
  category.value = "";
  source.value = "";
  sort.value = "updated";
  applyFilters();
}

async function loadPage(target: number): Promise<void> {
  if (loading.value) {
    pendingPage = target;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const params: Record<string, string | number | boolean> = {
      page: target,
      page_size: pageSize.value,
      sort: sort.value,
      fields: PAGE_FIELDS,
      // 老服务端会忽略未知 query 参数，自动降级为「仅本地书库」
      origin: origin.value,
    };
    if (category.value) params.category = category.value;
    if (source.value) params.source = source.value;
    if (query.value.trim()) params.q = query.value.trim();
    const data = await bridge.getBooks<PagedResult<BookListItem> & { counts?: Record<string, number> }>(params);
    books.value = data.items;
    originCounts.value = data.counts ?? null;
    if (!data.counts) {
      // 老服务端：忽略 origin，退回仅本地书库，避免筛选结果与标签不符
      originSupported.value = false;
      if (origin.value !== "all") origin.value = "all";
    } else {
      originSupported.value = true;
    }
    total.value = data.total;
    page.value = data.page;
    // 翻页回到网格顶部
    gridAreaRef.value?.scrollTo({ top: 0, behavior: "auto" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "书库加载失败";
  } finally {
    loading.value = false;
    const next = pendingPage;
    pendingPage = null;
    if (next !== null) void loadPage(next);
  }
}

function goPage(p: number): void {
  if (p < 1 || p > totalPages.value || p === page.value || loading.value) return;
  void loadPage(p);
}

async function fetchContinue(): Promise<void> {
  try {
    const data = await bridge.getBooks<PagedResult<BookListItem>>({
      read: true,
      sort: "read",
      page: 1,
      page_size: 20,
      fields: PAGE_FIELDS,
    });
    continueBooks.value = data.items;
  } catch {
    continueBooks.value = [];
  }
}

// —— 书库打开时从 WebDAV 批量同步进度 ——
// 手机 Legado 写的新进度只在 WebDAV 里，服务端 DB 不会自己更新；
// 打开书库（含阅读窗口关闭后）先在后台批量拉取，有更新再刷新卡片与封面进度条。
// 只同步书库中已存在的书籍：手机书架通常更大，书库外的进度文件由服务端忽略，
// 继续阅读列表永远不会出现书库外的书。
const PROGRESS_SYNC_THROTTLE = 15_000;
let lastProgressSyncAt = 0;
let syncPromise: Promise<SyncOutcome> | null = null;
/** 老服务端没有 /sync/pull-all 时降级为逐本 pull，避免每次都吃 404 */
let batchSyncSupported = true;

interface SyncOutcome {
  changed: boolean;
  /** 服务端返回的逐本新进度；null = 无法增量更新（老服务端/降级路径） */
  books: ProgressUpdatedBook[] | null;
}

/** 把同步到的进度写回卡片；返回 false 表示必须整页刷新才能保证列表正确 */
function applySyncedProgress(updates: ProgressUpdatedBook[]): boolean {
  const byId = new Map<number, ProgressUpdatedBook>();
  for (const u of updates) byId.set(u.book_id, u);

  const merge = (list: BookListItem[]): void => {
    for (const book of list) {
      const u = byId.get(book.id);
      if (!u) continue;
      if (typeof u.read_percent === "number") book.read_percent = u.read_percent;
      if (typeof u.chapter_index === "number") book.read_chapter_index = u.chapter_index;
      if (typeof u.read_at === "string" && u.read_at) book.read_at = u.read_at;
    }
  };

  const continueIds = new Set(continueBooks.value.map((b) => b.id));
  // 更新到的书不在继续阅读里 ⇒ 它可能刚进入前 20，需要整页刷新才能补位
  const covered = updates.every((u) => continueIds.has(u.book_id));
  merge(continueBooks.value);
  merge(books.value);
  if (covered) {
    continueBooks.value = [...continueBooks.value].sort(
      (a, b) => (Date.parse(b.read_at ?? "") || 0) - (Date.parse(a.read_at ?? "") || 0),
    );
  }
  return covered;
}

function syncProgressFromWebDAV(): Promise<SyncOutcome> {
  const idle: SyncOutcome = { changed: false, books: null };
  if (!session.authed) return Promise.resolve(idle);
  if (Date.now() - lastProgressSyncAt < PROGRESS_SYNC_THROTTLE) return Promise.resolve(idle);
  if (syncPromise) return syncPromise;
  syncPromise = (async (): Promise<SyncOutcome> => {
    try {
      if (batchSyncSupported) {
        try {
          const result = await bridge.pullAllLegadoProgress();
          lastProgressSyncAt = Date.now();
          console.debug(
            `[sync] WebDAV 批量进度：远端 ${result.remote_files ?? 0} 个文件 / 命中书库 ${result.matched ?? 0} 本 / 忽略书库外 ${result.ignored ?? 0} 个 / 跳过未变 ${result.skipped ?? 0} 个 / 更新 ${result.updated ?? 0} 本`,
          );
          const books = Array.isArray(result.books) ? result.books : null;
          return { changed: (result.updated ?? 0) > 0, books };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          if (/404|not found/i.test(msg)) batchSyncSupported = false;
          else return idle; // 网络异常静默降级，下次打开会重试
        }
      }
      // 老服务端：对当前继续阅读卡片逐本 pull，写回 DB
      let changed = false;
      await Promise.all(
        continueBooks.value.slice(0, 20).map(async (book) => {
          try {
            const r = (await bridge.pullLegadoProgress(book.id)) as { updated?: boolean };
            if (r?.updated) changed = true;
          } catch {
            // 单本失败不影响其它书
          }
        }),
      );
      lastProgressSyncAt = Date.now();
      return { changed, books: null };
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}

async function loadContinue(): Promise<void> {
  await fetchContinue();
  // 后台同步，不阻塞书库首屏；能拿到逐本结果就原地改卡片，否则整页刷新
  void syncProgressFromWebDAV().then((outcome) => {
    if (!outcome.changed) return;
    const applied = outcome.books?.length ? applySyncedProgress(outcome.books) : false;
    if (!applied) void refresh();
  });
}

// —— 继续阅读由 ContinueReadingStrip 组件负责滚动与箭头 ——

/** 搜索：输入防抖后走服务端 q（书名/作者），重置到第一页 */
let searchTimer = 0;
function onSearchInput(): void {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void loadPage(1), 350);
}

async function refresh(): Promise<void> {
  reloading.value = true;
  await Promise.all([loadPage(page.value), loadContinue(), loadFacets()]);
  reloading.value = false;
}

function openBook(book: BookListItem): void {
  // 负数 id / readable=false = 仅 Legado 在线书，服务端没有正文
  if (book.readable === false || book.id < 0) {
    onlineBook.value = book;
    return;
  }
  void router.push({ name: "book-detail", params: { id: String(book.id) } });
}

/** 在线书登记成功：关弹窗、刷新书库，再进阅读器 */
async function onOnlineAdopted(bookId: number): Promise<void> {
  onlineBook.value = null;
  await refresh();
  void window.api.window.enterReader(bookId);
}

/** 继续阅读卡直达：跳过详情页，阅读窗按本地/服务端/WebDAV 进度自行恢复 */
function resumeBook(book: BookListItem): void {
  if (book.readable === false || book.id < 0) {
    openBook(book);
    return;
  }
  void window.api.window.enterReader(book.id);
}

let offLibraryRefresh: (() => void) | null = null;

onMounted(() => {
  // 先按当前布局算好每页数量，再拉首页数据
  pageSize.value = computePageSize();
  if (session.authed) void loadPage(1);
  if (session.authed) void loadContinue();
  if (session.authed) void loadFacets();
  // 阅读窗口关闭时主进程通知刷新（立即看到最新阅读进度）
  offLibraryRefresh = window.api.onLibraryRefresh(() => {
    if (session.authed) void refresh();
  });
  resizeObserver = new ResizeObserver(recalcPageSize);
  if (gridAreaRef.value) resizeObserver.observe(gridAreaRef.value);
  window.addEventListener("resize", recalcPageSize);
});

onUnmounted(() => {
  offLibraryRefresh?.();
  offLibraryRefresh = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.clearTimeout(resizeTimer);
  window.removeEventListener("resize", recalcPageSize);
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

    <!-- 筛选栏：来源 / 分类 / 书源 / 排序 -->
    <LibraryFilterBar
      v-model:origin="origin"
      v-model:category="category"
      v-model:source="source"
      v-model:sort="sort"
      :facets="facets"
      :origin-supported="originSupported"
      :has-active-filters="hasActiveFilters"
      :total="total"
      :counts="originCounts"
      @apply="applyFilters"
      @reset="resetFilters"
    />

    <div v-if="error" class="error-tip">{{ error }}</div>

    <!-- 继续阅读：单行横滑（箭头 + 滚轮） -->
    <ContinueReadingStrip
      v-if="!query && !hasActiveFilters && continueBooks.length"
      :books="continueBooks"
      @open="openBook"
      @resume="resumeBook"
    />

    <!-- 书籍网格（外层容器始终渲染且 flex 占满剩余高度，供测量列数/行数） -->
    <div ref="gridAreaRef" class="grid-area">
      <LibraryBookGrid
        :books="books"
        :loading="loading"
        :query="query"
        :has-active-filters="hasActiveFilters"
        @open="openBook"
      />
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

    <!-- 在线书信息：来自 Legado 书架，服务端没有正文 -->
    <OnlineBookModal
      v-if="onlineBook"
      :book="onlineBook"
      @close="onlineBook = null"
      @adopted="onOnlineAdopted"
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
</style>
