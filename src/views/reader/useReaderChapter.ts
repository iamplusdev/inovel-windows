/** 目录与章节正文：分页拉全目录、LRU 缓存 + ETag 校验、切章预取 */
import { computed, nextTick, ref } from "vue";
import type { Ref } from "vue";
import { RequestCanceledError, bridge } from "@/api/bridge";
import type { ChapterContent } from "@/api/bridge";
import type { TocItem } from "@/types/api";

const TOC_PAGE_SIZE = 500;
const TOC_MAX_PAGES = 40;
/** 余页并发数：首屏只需一次 RTT，大目录显著缩短等待 */
const TOC_PARALLEL = 4;

const CHAPTER_CACHE_LIMIT = 30;

const DEMO_PARAGRAPHS = [
  "这是 iNovel 的阅读器骨架，用于验证无边框窗口、沉浸阅读和正文背景透明度。",
  "打开书库选择一本书即可阅读真实章节内容。",
];

interface CachedChapter {
  content: string;
  etag: string;
}

interface PrefetchJob {
  epoch: number;
  promise: Promise<ChapterContent>;
}

export interface ReaderChapterOptions {
  bookId: Ref<number>;
  scrollRef: Ref<HTMLElement | null>;
  settingsOpen: Ref<boolean>;
  chapterRatio: Ref<number>;
  linePx: () => number;
  showToast: (message: string) => void;
  /** 切章后立即落进度（由进度模块提供） */
  persist: () => void;
}

export function useReaderChapter({
  bookId,
  scrollRef,
  settingsOpen,
  chapterRatio,
  linePx,
  showToast,
  persist,
}: ReaderChapterOptions) {
  /** 完整目录（分页拉全） */
  const toc = ref<TocItem[]>([]);
  /** 当前章节 */
  const current = ref<TocItem | null>(null);
  /** 章节正文段落 */
  const paragraphs = ref<string[]>([]);
  /** 目录抽屉 */
  const tocOpen = ref(false);
  const tocFilter = ref("");
  const filteredToc = computed(() => {
    const kw = tocFilter.value.trim().toLowerCase();
    if (!kw) return toc.value;
    return toc.value.filter((c) => (c.name || c.title || "").toLowerCase().includes(kw));
  });

  /** 当前章在目录中的序号 */
  const currentIndex = computed(() => {
    if (!current.value) return -1;
    return toc.value.findIndex((c) => c.id === current.value!.id);
  });

  /** 用户主动选章标记：目录点章 / 键盘切章 / 详情页带 chapter 参数进入后，
   *  启动时的进度恢复与 WebDAV 自动跳转都不能覆盖用户的选择 */
  const userChoseChapter = ref(false);
  /** 阅读窗口已存在时主进程发来的切章请求（目录加载完成前先暂存） */
  const externalChapterId = ref(0);
  let chapterSeq = 0;

  // —— 章节正文缓存：重复打开先渲染缓存，再带 If-None-Match 校验（304 复用） ——
  const chapterCache = new Map<number, CachedChapter>();
  /** 换源会原地复用章节 id：预取结果按代际丢弃 */
  let cacheEpoch = 0;

  /** 读取并刷新 LRU 顺序；未命中返回 undefined */
  function readChapterCache(id: number): CachedChapter | undefined {
    const hit = chapterCache.get(id);
    if (!hit) return undefined;
    chapterCache.delete(id);
    chapterCache.set(id, hit);
    return hit;
  }

  function writeChapterCache(id: number, entry: CachedChapter): void {
    chapterCache.delete(id);
    chapterCache.set(id, entry);
    while (chapterCache.size > CHAPTER_CACHE_LIMIT) {
      const oldest = chapterCache.keys().next().value;
      if (oldest === undefined) break;
      chapterCache.delete(oldest);
    }
  }

  /** 换源后章节 id 原地复用但正文已变：清空缓存并让在途预取失效 */
  function invalidateChapters(): void {
    chapterCache.clear();
    cacheEpoch++;
  }

  function splitParagraphs(text: string): string[] {
    return text
      .split(/\r?\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** 渲染章节正文并恢复章内滚动位置（对齐行网格）；seq 过期则放弃 */
  async function renderChapter(
    ch: TocItem,
    text: string,
    restoreRatio: number,
    seq: number,
  ): Promise<void> {
    if (seq !== chapterSeq) return;
    current.value = ch;
    paragraphs.value = splitParagraphs(text);
    tocOpen.value = false;
    await nextTick();
    if (seq !== chapterSeq) return;
    const el = scrollRef.value;
    if (el) {
      const lpx = linePx();
      const max = el.scrollHeight - el.clientHeight;
      const target = Math.round((restoreRatio * max) / lpx) * lpx;
      el.scrollTop = Math.max(0, Math.min(max, target));
      chapterRatio.value = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
    }
  }

  /** 缓存命中的后台校验：304 复用缓存，200 才替换正文 */
  async function revalidateChapter(ch: TocItem, cached: CachedChapter, seq: number) {
    try {
      const fresh = await bridge.getChapter(bookId.value, ch.id, cached.etag);
      if (fresh.notModified) return;
      writeChapterCache(ch.id, { content: fresh.content, etag: fresh.etag });
      if (seq !== chapterSeq || current.value?.id !== ch.id) return;
      // 正文确有变化：原地替换，不重置用户滚动位置
      paragraphs.value = splitParagraphs(fresh.content);
    } catch {
      // 校验失败不影响已展示的缓存内容，下次打开再试
    }
  }

  /** 在途预取：用户点到同一章时直接复用，不再重复请求 */
  const prefetchJobs = new Map<number, PrefetchJob>();

  /** 后台预取下一章；已有缓存或已不是当前章则跳过 */
  function prefetchNext(ch: TocItem, seq: number): void {
    if (seq !== chapterSeq) return;
    const idx = toc.value.findIndex((c) => c.id === ch.id);
    const next = idx >= 0 ? toc.value[idx + 1] : undefined;
    if (!next || chapterCache.has(next.id) || prefetchJobs.has(next.id)) return;
    const epoch = cacheEpoch;
    const promise = bridge.prefetchChapter(bookId.value, next.id);
    prefetchJobs.set(next.id, { epoch, promise });
    void promise
      .then((data) => {
        if (data.notModified || epoch !== cacheEpoch) return;
        writeChapterCache(next.id, { content: data.content, etag: data.etag });
      })
      .catch(() => {
        // 预取失败不打扰阅读
      })
      .finally(() => {
        if (prefetchJobs.get(next.id)?.promise === promise) prefetchJobs.delete(next.id);
      });
  }

  async function fetchTocPage(page: number): Promise<{ items: TocItem[]; total: number }> {
    const resp = await bridge.getToc<{ items: TocItem[]; total: number }>(
      bookId.value,
      page,
      TOC_PAGE_SIZE,
    );
    return { items: resp.items ?? [], total: resp.total ?? 0 };
  }

  /** 分页拉全目录：首页拿 total，余页限流并行，结果按页码顺序拼接 */
  async function loadTocAll(): Promise<TocItem[]> {
    const first = await fetchTocPage(1);
    if (first.items.length === 0) return [];
    const pages = Math.min(TOC_MAX_PAGES, Math.max(1, Math.ceil(first.total / TOC_PAGE_SIZE)));
    const all = [...first.items];
    for (let start = 2; start <= pages; start += TOC_PARALLEL) {
      const batch: Promise<{ items: TocItem[]; total: number }>[] = [];
      for (let page = start; page < start + TOC_PARALLEL && page <= pages; page++) {
        batch.push(fetchTocPage(page));
      }
      for (const page of await Promise.all(batch)) all.push(...page.items);
    }
    return all;
  }

  /** 打开指定章节；restoreRatio 为章内滚动恢复比例。
   *  新请求会由主进程中止上一篇的旧请求，seq 保证只有最后一次结果落地 */
  async function openChapter(ch: TocItem, restoreRatio = 0) {
    const seq = ++chapterSeq;
    try {
      const cached = readChapterCache(ch.id);
      if (cached) {
        // 先展示缓存避免空屏；校验放后台，不阻塞切章
        await renderChapter(ch, cached.content, restoreRatio, seq);
        if (seq !== chapterSeq) return;
        persist();
        if (cached.etag) void revalidateChapter(ch, cached, seq);
        prefetchNext(ch, seq);
        return;
      }

      const job = prefetchJobs.get(ch.id);
      let data: ChapterContent;
      if (job && job.epoch === cacheEpoch) {
        try {
          data = await job.promise;
        } catch {
          // 预取被中止或失败：仍是最新章节才补一次直接请求
          if (seq !== chapterSeq) return;
          data = await bridge.getChapter(bookId.value, ch.id);
        }
      } else {
        data = await bridge.getChapter(bookId.value, ch.id);
      }
      if (seq !== chapterSeq) return;
      writeChapterCache(ch.id, { content: data.content, etag: data.etag });
      await renderChapter(ch, data.content, restoreRatio, seq);
      if (seq !== chapterSeq) return;
      // 切章是关键节点：立即写本地 + 服务端 + 推 Legado
      persist();
      prefetchNext(ch, seq);
    } catch (err) {
      if (err instanceof RequestCanceledError) return;
      if (seq !== chapterSeq) return;
      showToast(err instanceof Error ? err.message : "章节加载失败");
    }
  }

  /** 用户主动切章（目录抽屉、左右方向键、详情页目录），标记后禁止自动跳章覆盖 */
  function chooseChapter(ch: TocItem): void {
    userChoseChapter.value = true;
    void openChapter(ch, 0);
  }

  function prevChapter() {
    const i = currentIndex.value;
    if (i <= 0) {
      showToast("已经是第一章");
      return;
    }
    chooseChapter(toc.value[i - 1]);
  }

  function nextChapter() {
    const i = currentIndex.value;
    if (i < 0 || i >= toc.value.length - 1) {
      showToast("已经是最后一章");
      return;
    }
    chooseChapter(toc.value[i + 1]);
  }

  function toggleToc() {
    tocOpen.value = !tocOpen.value;
    if (tocOpen.value) {
      tocFilter.value = "";
      settingsOpen.value = false;
    }
  }

  return {
    toc,
    current,
    paragraphs,
    tocOpen,
    tocFilter,
    filteredToc,
    currentIndex,
    userChoseChapter,
    externalChapterId,
    demoParagraphs: DEMO_PARAGRAPHS,
    loadTocAll,
    openChapter,
    chooseChapter,
    prevChapter,
    nextChapter,
    toggleToc,
    invalidateChapters,
  };
}
