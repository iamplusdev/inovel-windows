<script setup lang="ts">
/** 书库筛选：书架来源 / 分类 / 书源 / 排序 */
import type { BookFacets } from "@/types/api";

defineProps<{
  origin: string;
  category: string;
  source: string;
  sort: string;
  facets: BookFacets;
  originSupported: boolean;
  hasActiveFilters: boolean;
  total: number;
  counts: Record<string, number> | null;
}>();

const emit = defineEmits<{
  "update:origin": [value: string];
  "update:category": [value: string];
  "update:source": [value: string];
  "update:sort": [value: string];
  apply: [];
  reset: [];
}>();

const ORIGIN_OPTS = [
  { value: "all", label: "全部书架" },
  { value: "both", label: "双端共有" },
  { value: "server", label: "仅服务端" },
  { value: "legado", label: "仅手机在线" },
];

const SORT_OPTS = [
  { value: "updated", label: "最近更新" },
  { value: "title", label: "书名" },
  { value: "author", label: "作者" },
  { value: "words", label: "字数" },
  { value: "chapters", label: "章节数" },
  { value: "read", label: "最近阅读" },
];

function value(e: Event): string {
  return (e.target as HTMLSelectElement).value;
}
</script>

<template>
  <div class="filter-bar">
    <select
      class="field-input filter-select filter-origin"
      :value="origin"
      :disabled="!originSupported"
      :title="originSupported ? '筛选书架来源' : '当前服务端版本不支持合并书架，请先升级服务端'"
      @change="emit('update:origin', value($event)); emit('apply')"
    >
      <option v-for="opt in ORIGIN_OPTS" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <select
      v-if="facets.categories.length"
      class="field-input filter-select filter-category"
      :value="category"
      title="按分类筛选"
      @change="emit('update:category', value($event)); emit('apply')"
    >
      <option value="">全部分类</option>
      <option v-for="name in facets.categories" :key="name" :value="name">{{ name }}</option>
    </select>
    <select
      v-if="facets.sources.length"
      class="field-input filter-select filter-source"
      :value="source"
      title="按书源筛选"
      @change="emit('update:source', value($event)); emit('apply')"
    >
      <option value="">全部书源</option>
      <option v-for="name in facets.sources" :key="name" :value="name">{{ name }}</option>
    </select>
    <select
      class="field-input filter-select filter-sort"
      :value="sort"
      title="排序方式"
      @change="emit('update:sort', value($event)); emit('apply')"
    >
      <option v-for="opt in SORT_OPTS" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <button v-if="hasActiveFilters" type="button" class="ghost-btn filter-reset" @click="emit('reset')">
      重置
    </button>
    <span v-if="hasActiveFilters" class="filter-tip">筛选后 {{ total }} 本</span>
  </div>

  <div v-if="counts" class="origin-summary">
    <span>合并书架：共有 {{ counts.both ?? 0 }} · 仅服务端 {{ counts.server ?? 0 }} · 仅手机在线 {{ counts.legado ?? 0 }}</span>
    <span class="origin-hint">仅手机在线的书可点开转为服务端在线书后直接阅读</span>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.filter-select {
  width: 118px;
  height: 30px;
  font-size: 12px;
}

.filter-category {
  width: 150px;
}

.filter-source {
  width: 140px;
}

.filter-reset {
  height: 30px;
  padding: 0 12px;
  font-size: 12px;
}

.filter-tip {
  font-size: 12px;
  color: var(--color-text-3);
}

.origin-summary {
  display: flex;
  gap: 16px;
  align-items: center;
  font-size: 12px;
  color: var(--color-text-3);
}

.origin-hint {
  opacity: 0.8;
}
</style>
