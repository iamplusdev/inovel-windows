/** 视口交互：按整行滚动、滚轮累积、右下角窗口缩放、双击隐藏 */
import type { Ref } from "vue";

/** 拖拽右下角手柄：直接缩放阅读窗口本身（窗口边界=正文边界，无内部空白） */
const READER_DEFAULT = { width: 480, height: 720 };

export interface ReaderViewportOptions {
  scrollRef: Ref<HTMLElement | null>;
  linePx: () => number;
  showToast: (message: string) => void;
  /** 摸鱼：双击阅读区隐藏窗口 */
  doubleClickHide: Ref<boolean>;
}

export function useReaderViewport({
  scrollRef,
  linePx,
  showToast,
  doubleClickHide,
}: ReaderViewportOptions) {
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

  /** 摸鱼：双击瞬间隐藏窗口（主进程鼠标轮询判定，找回 = 托盘图标或老板键） */
  function onCaptionDblClick(): void {
    if (!doubleClickHide.value) return;
    void window.api.boss.hide();
  }

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

  return {
    scrollByLines,
    onWheel,
    onCaptionDblClick,
    onResizeStart,
    onHandleDblClick,
  };
}
