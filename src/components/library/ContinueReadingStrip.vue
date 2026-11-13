<script setup lang="ts">
/** 继续阅读：单行横滑（箭头 + 滚轮），无滚动条 */
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { BookListItem } from "@/types/api";
import { fmtReadAt } from "@/utils/format";

const props = defineProps<{ books: BookListItem[] }>();

const emit = defineEmits<{
  open: [book: BookListItem];
  resume: [book: BookListItem];
}>();

const rowRef = ref<HTMLElement | null>(null);
const canLeft = ref(false);
const canRight = ref(false);
let observer: ResizeObserver | null = null;

function updateArrows(): void {
  const el = rowRef.value;
  if (!el) return;
  canLeft.value = el.scrollLeft > 4;
  canRight.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 4;
}

function slide(dir: number): void {
  const el = rowRef.value;
  if (!el) return;
  el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
}

/** 纵向滚轮转横向；滑到边缘时放行页面滚动 */
function onWheel(e: WheelEvent): void {
  const el = rowRef.value;
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

/** 继续阅读卡的章节标签：无记录返回空串 */
function chapterLabel(book: BookListItem): string {
  const idx = book.read_chapter_index ?? -1;
  if (idx < 0) return "";
  return `第 ${idx + 1}/${book.chapter_count ?? "?"} 章 · `;
}

watch(
  () => props.books,
  () => {
    void nextTick(updateArrows);
  },
);

onMounted(() => {
  observer = new ResizeObserver(updateArrows);
  if (rowRef.value) observer.observe(rowRef.value);
  window.addEventListener("resize", updateArrows);
  void nextTick(updateArrows);
});

onUnmounted(() => {
  observer?.disconnect();
  observer = null;
  window.removeEventListener("resize", updateArrows);
});
</script>

<template>
  <section class="page-card continue-card">
    <h2 class="section-title">继续阅读</h2>
    <div class="continue-strip">
      <button
        v-if="canLeft"
        type="button"
        class="strip-arrow left"
        aria-label="向左滑动"
        @click="slide(-1)"
      >
        ‹
      </button>
      <div ref="rowRef" class="continue-row" @wheel="onWheel" @scroll="updateArrows">
        <div
          v-for="book in books"
          :key="book.id"
          class="continue-item"
          role="button"
          tabindex="0"
          @click="emit('open', book)"
          @keydown.enter.self.prevent="emit('open', book)"
          @keydown.space.self.prevent="emit('open', book)"
        >
          <span class="continue-top">
            <span class="continue-name">{{ book.name }}</span>
            <button
              type="button"
              class="continue-resume"
              title="直接打开阅读器"
              @click.stop="emit('resume', book)"
            >
              继续
            </button>
          </span>
          <span class="continue-meta">
            {{ chapterLabel(book) }}{{ book.read_percent ?? 0 }}%{{ fmtReadAt(book.read_at) }}
          </span>
          <span class="mini-progress">
            <span class="mini-progress-bar" :style="{ width: `${book.read_percent ?? 0}%` }" />
          </span>
        </div>
      </div>
      <button
        v-if="canRight"
        type="button"
        class="strip-arrow right"
        aria-label="向右滑动"
        @click="slide(1)"
      >
        ›
      </button>
    </div>
  </section>
</template>

<style scoped>
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

.continue-item:hover,
.continue-item:focus-visible {
  border-color: var(--color-accent);
  outline: none;
}

.continue-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 卡片内的直达按钮：拦截冒泡，单击卡片仍进详情 */
.continue-resume {
  flex: none;
  padding: 2px 10px;
  border: none;
  border-radius: 999px;
  background: var(--color-accent);
  color: #fff;
  font-family: inherit;
  font-size: 11px;
  line-height: 1.6;
  cursor: pointer;
}

.continue-resume:hover {
  filter: brightness(1.08);
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
  flex: 1;
  min-width: 0;
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
</style>
