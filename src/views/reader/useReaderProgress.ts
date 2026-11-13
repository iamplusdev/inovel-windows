/** 阅读进度：本地防抖保存、服务端节流写回、Legado WebDAV 推送与拉取 */
import { computed, ref } from "vue";
import type { Ref } from "vue";
import { bridge } from "@/api/bridge";
import type { AppConfigShape, LocalProgressShape } from "@/types/global";
import type { TocItem } from "@/types/api";

export interface ReaderProgressOptions {
  bookId: Ref<number>;
  toc: Ref<TocItem[]>;
  current: Ref<TocItem | null>;
  currentIndex: Ref<number>;
  paragraphs: Ref<string[]>;
  scrollRef: Ref<HTMLElement | null>;
  chapterRatio: Ref<number>;
  linePx: () => number;
  showToast: (message: string) => void;
  openChapter: (ch: TocItem, restoreRatio?: number) => Promise<void>;
  userChoseChapter: Ref<boolean>;
}

export function useReaderProgress({
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
}: ReaderProgressOptions) {
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

  /** 全书进度：章节位置 + 章内滚动比例 */
  const overallPercent = computed(() => progressPercent(chapterRatio.value));

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
    const el = scrollRef.value;
    if (el) {
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      chapterRatio.value = Math.min(1, Math.max(0, el.scrollTop / max));
    }
    if (current.value) saveProgress(false);
  }

  /** WebDAV 进度拉取：服务端对比远端后写回 DB；远端更新则跳转（最新者胜） */
  function startPull(localProgress: LocalProgressShape | null): void {
    // 用户已明确选章（详情页目录 / 抽屉目录 / 键盘切章）时不再自动跳章
    if (!syncToLegado.value || toc.value.length === 0 || userChoseChapter.value) return;
    void (async () => {
      try {
        const resp = await bridge.pullLegadoProgress(bookId.value);
        if (userChoseChapter.value) return; // 拉取期间用户点了章节
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
        const localMs = localProgress?.updatedAt ? Date.parse(localProgress.updatedAt) : 0;
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

  /** 启动时应用同步开关配置 */
  function applySyncConfig(sync: AppConfigShape["sync"]): void {
    syncToServer.value = sync.toServer !== false;
    syncToLegado.value = sync.toLegado !== false;
  }

  function disposeProgress(): void {
    window.clearTimeout(localSaveTimer);
  }

  return {
    overallPercent,
    parseServerTime,
    saveProgress,
    onScroll,
    startPull,
    applySyncConfig,
    disposeProgress,
  };
}
