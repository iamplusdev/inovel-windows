/** 在线书换源：按书名搜其他源，成功后重建目录并回到原章节序号 */
import { ref } from "vue";
import type { Ref } from "vue";
import { bridge } from "@/api/bridge";
import type { BookSourceCandidate } from "@/api/bridge";
import type { TocItem } from "@/types/api";

export interface ReaderSourceOptions {
  bookId: Ref<number>;
  bookName: Ref<string>;
  isOnline: Ref<boolean>;
  current: Ref<TocItem | null>;
  scrollRef: Ref<HTMLElement | null>;
  toc: Ref<TocItem[]>;
  paragraphs: Ref<string[]>;
  demoParagraphs: string[];
  settingsOpen: Ref<boolean>;
  tocOpen: Ref<boolean>;
  loadTocAll: () => Promise<TocItem[]>;
  openChapter: (ch: TocItem, restoreRatio?: number) => Promise<void>;
  invalidateChapters: () => void;
  persist: () => void;
  showToast: (message: string) => void;
}

export function useReaderSources({
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
  persist,
  showToast,
}: ReaderSourceOptions) {
  const sourceOpen = ref(false);
  const sourceLoading = ref(false);
  const sourceError = ref("");
  const sourceHint = ref("");
  const sourceItems = ref<BookSourceCandidate[]>([]);
  const sourceCurrent = ref("");
  /** 正在切换到的书源 id（0=空闲） */
  const switchingSource = ref(0);

  async function loadSourceCandidates() {
    if (!bookId.value) return;
    sourceLoading.value = true;
    sourceError.value = "";
    try {
      const data = await bridge.getBookSources(bookId.value);
      sourceItems.value = data.items || [];
      sourceCurrent.value = data.current?.source_name || bookName.value;
      sourceHint.value = data.hint || "";
    } catch (err) {
      sourceItems.value = [];
      sourceHint.value = "";
      sourceError.value = err instanceof Error ? err.message : "搜索书源失败";
    } finally {
      sourceLoading.value = false;
    }
  }

  async function openSourcePicker() {
    if (!isOnline.value) return;
    sourceOpen.value = true;
    tocOpen.value = false;
    settingsOpen.value = false;
    sourceError.value = "";
    await loadSourceCandidates();
  }

  async function applySource(item: BookSourceCandidate) {
    if (item.current || switchingSource.value || !bookId.value) return;
    const chapterIndex = current.value?.index ?? -1;
    const el = scrollRef.value;
    const keepRatio = el
      ? Math.min(1, Math.max(0, el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)))
      : 0;
    switchingSource.value = item.source_id;
    sourceError.value = "";
    try {
      // 先落进度，换源后按章节序号恢复
      persist();
      await bridge.switchBookSource(bookId.value, {
        source_id: item.source_id,
        book_url: item.book_url,
        toc_url: item.toc_url,
        word_count: item.word_count,
      });
      // 章节 id 原地复用但正文已换源，缓存与在途预取都必须失效
      invalidateChapters();
      toc.value = await loadTocAll();
      const target = toc.value.find((c) => c.index === chapterIndex) ?? toc.value[0] ?? null;
      if (target) {
        await openChapter(target, keepRatio);
        sourceOpen.value = false;
        showToast(`已切换到「${item.source_name || "新书源"}」`);
      } else {
        paragraphs.value = demoParagraphs;
        showToast("新书源没有目录");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "切换书源失败";
      sourceError.value = message;
      showToast(message);
    } finally {
      switchingSource.value = 0;
    }
  }

  return {
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
  };
}
