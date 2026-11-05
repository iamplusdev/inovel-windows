<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { bridge } from "@/api/bridge";
import PaginationBar from "@/components/PaginationBar.vue";
import type { BookDetail, TocItem, TocResult } from "@/types/api";

const route = useRoute();
const router = useRouter();

const bookId = computed(() => Number(route.params.id));

const book = ref<BookDetail | null>(null);
const chapters = ref<TocItem[]>([]);
const tocTotal = ref(0);
const loading = ref(false);
const error = ref("");
const chapterFilter = ref("");
const listRef = ref<HTMLElement | null>(null);

/** 目录经典分页：100 章/页 */
const TOC_PAGE_SIZE = 100;
const tocPage = ref(1);
const tocLoading = ref(false);
const tocTotalPages = computed(() => Math.max(1, Math.ceil(tocTotal.value / TOC_PAGE_SIZE)));

/** 筛选时的全量章节缓存（自动拉全后本地过滤） */
const allChapters = ref<TocItem[] | null>(null);
const filterLoadingAll = ref(false);

const currentChapterIndex = computed(() => book.value?.read_chapter_index ?? -1);
const hasProgress = computed(() => (book.value?.read_percent ?? 0) > 0 || currentChapterIndex.value >= 0);

/** 筛选激活时走全量缓存过滤，否则显示当前分页 */
const filterActive = computed(() => !!chapterFilter.value.trim());
const visibleChapters = computed(() => {
  if (!filterActive.value) return chapters.value;
  const kw = chapterFilter.value.trim().toLowerCase();
  const pool = allChapters.value ?? chapters.value;
  return pool.filter((c) => (c.name || c.title || "").toLowerCase().includes(kw));
});

async function loadBook(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    book.value = await bridge.getBook<BookDetail>(bookId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "书籍详情加载失败";
  } finally {
    loading.value = false;
  }
}

async function loadTocPage(page: number, pageSize = TOC_PAGE_SIZE): Promise<{ items: TocItem[]; total: number }> {
  const data = await bridge.getToc<TocResult>(bookId.value, page, pageSize);
  return { items: data.items, total: data.total };
}

async function loadFirstTocPage(): Promise<void> {
  try {
    const { items, total } = await loadTocPage(1);
    chapters.value = items;
    tocTotal.value = total;
    tocPage.value = 1;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "目录加载失败";
  }
}

/** 目录翻页：替换当前页章节并回到列表顶部 */
async function goTocPage(p: number): Promise<void> {
  if (p < 1 || p > tocTotalPages.value || p === tocPage.value || tocLoading.value) return;
  tocLoading.value = true;
  try {
    const { items } = await loadTocPage(p);
    chapters.value = items;
    tocPage.value = p;
    listRef.value?.scrollTo({ top: 0 });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "目录加载失败";
  } finally {
    tocLoading.value = false;
  }
}

/** 筛选时自动把剩余章节拉全（最多 40 页保护），用于本地过滤 */
let filterTimer = 0;
function onFilterInput(): void {
  window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(async () => {
    if (!chapterFilter.value.trim()) return;
    if (allChapters.value && allChapters.value.length >= tocTotal.value) return;
    if (filterLoadingAll.value) return;
    filterLoadingAll.value = true;
    try {
      const pool: TocItem[] = allChapters.value ? [...allChapters.value] : [];
      const known = new Set(pool.map((c) => c.id));
      for (let p = 1; p <= 40 && pool.length < tocTotal.value; p++) {
        const { items } = await loadTocPage(p, 500);
        for (const it of items) {
          if (!known.has(it.id)) {
            known.add(it.id);
            pool.push(it);
          }
        }
        if (!chapterFilter.value.trim()) break;
      }
      allChapters.value = pool;
    } catch {
      // 拉全失败时退化为当前已加载数据过滤
    } finally {
      filterLoadingAll.value = false;
    }
  }, 300);
}

/** 在独立阅读窗口中打开本书 */
function openReader(): void {
  void window.api.window.enterReader(bookId.value);
}

/** 定位当前阅读章节：先翻到所在页，再滚动高亮 */
async function locateCurrent(): Promise<void> {
  if (currentChapterIndex.value < 0) return;
  // 筛选状态下在全量结果里找
  if (filterActive.value) {
    await nextTick();
    scrollToCurrentRow();
    return;
  }
  const targetPage = Math.floor(currentChapterIndex.value / TOC_PAGE_SIZE) + 1;
  if (targetPage !== tocPage.value) {
    await goTocPage(targetPage);
  }
  await nextTick();
  scrollToCurrentRow();
}

function scrollToCurrentRow(): void {
  const idx = visibleChapters.value.findIndex((c) => c.index === currentChapterIndex.value);
  if (idx < 0 || !listRef.value) return;
  const el = listRef.value.querySelectorAll<HTMLElement>(".chapter-item")[idx];
  el?.scrollIntoView({ block: "center" });
}

function fmtWords(n?: number): string {
  if (!n) return "";
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万字` : `${n} 字`;
}

onMounted(async () => {
  await Promise.all([loadBook(), loadFirstTocPage()]);
});
</script>

<template>
  <div class="page detail-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ book?.name || "书籍详情" }}</h1>
        <p class="page-subtitle">
          {{ book ? `${book.author} · ${book.category}` : `ID ${bookId}` }}
        </p>
      </div>
      <button type="button" class="ghost-btn" @click="router.back()">返回书库</button>
    </header>

    <div v-if="error" class="error-tip">{{ error }}</div>
    <div v-if="loading && !book" class="empty-tip">加载中…</div>

    <template v-if="book">
      <!-- 书籍信息卡 -->
      <section class="page-card info-card">
        <div class="cover-box">
          <img
            v-if="book.cover_thumb_url"
            class="cover-img"
            :src="book.cover_thumb_url"
            :alt="book.name"
            draggable="false"
          />
          <span v-else class="cover-fallback">{{ book.name.slice(0, 2) }}</span>
        </div>
        <div class="info-main">
          <h2 class="book-title">{{ book.name }}</h2>
          <p class="info-line">
            {{ book.author }} · {{ book.category }}
            <template v-if="book.status"> · {{ book.status }}</template>
          </p>
          <p class="info-line muted">
            {{ fmtWords(book.word_count) }}
            <template v-if="book.chapter_count"> · {{ book.chapter_count }} 章</template>
          </p>
          <p class="info-intro">{{ book.intro || "暂无简介" }}</p>
          <div v-if="hasProgress" class="progress-row">
            <span class="mini-progress">
              <span class="mini-progress-bar" :style="{ width: `${book.read_percent ?? 0}%` }" />
            </span>
            <span class="progress-text">已读 {{ book.read_percent ?? 0 }}%</span>
          </div>
          <div class="actions">
            <button type="button" class="primary-btn" @click="openReader">
              {{ hasProgress ? "继续阅读" : "开始阅读" }}
            </button>
          </div>
        </div>
      </section>

      <!-- 目录卡 -->
      <section class="page-card toc-card">
        <div class="toc-head">
          <h2 class="section-title">
            {{ filterActive ? `筛选结果 ${visibleChapters.length} 章` : `目录（${tocTotal} 章）` }}
          </h2>
          <div class="toc-tools">
            <input
              v-model="chapterFilter"
              class="field-input filter-input"
              placeholder="筛选章节"
              spellcheck="false"
              @input="onFilterInput"
            />
            <button
              v-if="hasProgress"
              type="button"
              class="ghost-btn sm"
              @click="locateCurrent"
            >
              定位当前章
            </button>
          </div>
        </div>
        <div ref="listRef" class="chapter-list">
          <button
            v-for="ch in visibleChapters"
            :key="ch.id"
            type="button"
            class="chapter-item"
            :class="{ 'is-current': ch.index === currentChapterIndex }"
            :title="ch.name || ch.title"
            @click="openReader"
          >
            <span class="chapter-index">{{ ch.index }}</span>
            <span class="chapter-name">{{ ch.name || ch.title }}</span>
            <span v-if="ch.index === currentChapterIndex" class="chapter-now">当前</span>
          </button>
          <div v-if="!visibleChapters.length" class="empty-tip" style="padding: 20px 0">
            无匹配章节
          </div>
          <div v-if="filterLoadingAll" class="filter-loading">正在加载全部章节用于筛选…</div>
        </div>
        <!-- 目录分页栏（筛选时隐藏） -->
        <PaginationBar
          v-if="tocTotalPages > 1 && !filterActive"
          class="toc-pager"
          :page="tocPage"
          :total-pages="tocTotalPages"
          :loading="tocLoading"
          @go="goTocPage"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  gap: 16px;
}

.error-tip {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: rgba(217, 75, 75, 0.1);
  color: #c23a3a;
  font-size: 13px;
}

.empty-tip {
  padding: 40px 0;
  text-align: center;
  color: var(--color-text-3);
  font-size: 13px;
}

/* 信息卡：封面 + 元信息 */
.info-card {
  display: flex;
  gap: 20px;
}

.cover-box {
  flex: none;
  width: 128px;
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
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #6a8bff, #4c6fff);
}

.info-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.book-title {
  margin: 0;
  font-size: 20px;
}

.info-line {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-2);
}

.info-line.muted {
  color: var(--color-text-3);
}

.info-intro {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.mini-progress {
  flex: none;
  width: 180px;
  height: 4px;
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

.progress-text {
  font-size: 12px;
  color: var(--color-text-3);
}

.actions {
  margin-top: auto;
  display: flex;
  gap: 10px;
}

/* 目录卡 */
.toc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.toc-head .section-title {
  margin: 0;
}

.toc-tools {
  display: flex;
  gap: 8px;
}

.filter-input {
  width: 180px;
  height: 28px;
  font-size: 12px;
}

.chapter-list {
  max-height: 46vh;
  overflow-y: auto;
  scrollbar-width: thin;
  border-top: 1px solid var(--color-border);
}

.chapter-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: var(--color-text-2);
  font-size: 13px;
}

.chapter-item:hover {
  background: var(--color-surface-2);
  color: var(--color-text);
}

.chapter-item.is-current {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.chapter-index {
  flex: none;
  width: 44px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-3);
}

.chapter-item.is-current .chapter-index {
  color: var(--color-accent);
}

.chapter-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chapter-now {
  flex: none;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--color-accent);
  color: #fff;
}

/* 目录分页栏与列表的间距 */
.toc-pager {
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
  margin-top: 4px;
}

.filter-loading {
  padding: 8px 0;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-3);
}
</style>
