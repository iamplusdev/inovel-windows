<script setup lang="ts">
/** 书架网格：封面墙 + 来源角标 + 阅读进度条 */
import type { BookListItem } from "@/types/api";

defineProps<{
  books: BookListItem[];
  loading: boolean;
  query: string;
  hasActiveFilters: boolean;
}>();

const emit = defineEmits<{ open: [book: BookListItem] }>();

function originLabel(b: BookListItem): string {
  if (b.origin === "legado") return "手机在线";
  if (b.origin === "both") return "双端共有";
  return "";
}
</script>

<template>
  <section v-if="books.length" class="book-grid">
    <button
      v-for="book in books"
      :key="book.id"
      type="button"
      class="book-card"
      @click="emit('open', book)"
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
        <span v-if="originLabel(book)" class="origin-badge" :class="`is-${book.origin}`">
          {{ originLabel(book) }}
        </span>
        <span v-if="(book.read_percent ?? 0) > 0" class="cover-progress">
          <span class="cover-progress-bar" :style="{ width: `${book.read_percent ?? 0}%` }" />
        </span>
      </span>
      <span class="book-name" :title="book.name">{{ book.name }}</span>
      <span class="book-meta">{{ book.author }}</span>
    </button>
  </section>

  <div v-else-if="!loading" class="empty-tip">
    {{ query || hasActiveFilters ? "没有找到匹配的书籍" : "书库还是空的，先去服务器导入书籍吧" }}
  </div>

  <div v-if="loading && !books.length" class="empty-tip">加载中…</div>
</template>

<style scoped>
/* 卡片来源角标 */
.origin-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 6px;
  border-radius: var(--radius-full);
  font-size: 10px;
  line-height: 1.4;
  color: #fff;
  background: rgba(76, 111, 255, 0.9);
}

.origin-badge.is-legado {
  background: rgba(217, 130, 45, 0.92);
}

.origin-badge.is-both {
  background: rgba(45, 158, 111, 0.9);
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
