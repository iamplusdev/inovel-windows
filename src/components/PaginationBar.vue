<script setup lang="ts">
import { computed } from "vue";

/**
 * 通用分页栏：上一页/下一页 + 页码窗口（首尾 + 当前页前后各 2 页 + 省略号）。
 * 书库网格与书籍详情目录共用，保证分页交互全局一致。
 */
const props = defineProps<{
  page: number;
  totalPages: number;
  loading?: boolean;
  /** 右侧统计文案，如「共 27 本 · 2 页」 */
  info?: string;
}>();

const emit = defineEmits<{ go: [page: number] }>();

const items = computed<(number | "…")[]>(() => {
  const t = props.totalPages;
  const cur = props.page;
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1);
  const set = new Set<number>([1, t, cur - 2, cur - 1, cur, cur + 1, cur + 2]);
  const nums = [...set].filter((n) => n >= 1 && n <= t).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
});

function go(p: number): void {
  if (p < 1 || p > props.totalPages || p === props.page || props.loading) return;
  emit("go", p);
}
</script>

<template>
  <nav class="pager" aria-label="分页">
    <button
      type="button"
      class="pager-btn"
      :disabled="page <= 1 || loading"
      @click="go(page - 1)"
    >
      上一页
    </button>
    <template v-for="(item, idx) in items" :key="`${item}-${idx}`">
      <span v-if="item === '…'" class="pager-ellipsis">…</span>
      <button
        v-else
        type="button"
        class="pager-btn pager-num"
        :class="{ 'is-active': item === page }"
        :disabled="loading"
        @click="go(item)"
      >
        {{ item }}
      </button>
    </template>
    <button
      type="button"
      class="pager-btn"
      :disabled="page >= totalPages || loading"
      @click="go(page + 1)"
    >
      下一页
    </button>
    <span v-if="info" class="pager-info">{{ info }}</span>
  </nav>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
}

.pager-btn {
  min-width: 32px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-2);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.pager-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.pager-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.pager-num.is-active {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: #fff;
  cursor: default;
}

.pager-ellipsis {
  min-width: 18px;
  text-align: center;
  color: var(--color-text-3);
  font-size: 12px;
}

.pager-info {
  margin-left: 8px;
  color: var(--color-text-3);
  font-size: 12px;
}
</style>
