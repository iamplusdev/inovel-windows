<script setup lang="ts">
/** 在线书信息：来自 Legado 书架，服务端没有正文；可转为服务端在线书 */
import { ref } from "vue";
import { bridge } from "@/api/bridge";
import type { BookListItem } from "@/types/api";
import { fmtReadAt } from "@/utils/format";

const props = defineProps<{ book: BookListItem }>();

const emit = defineEmits<{
  close: [];
  adopted: [bookId: number];
}>();

const adopting = ref(false);
const adoptError = ref("");

/** 仅 Legado 在线书 → 服务端在线书，登记成功后交给父视图刷新并进阅读器 */
async function adopt(): Promise<void> {
  const book = props.book;
  if (!book.shelf_id || adopting.value) return;
  adopting.value = true;
  adoptError.value = "";
  try {
    const result = await bridge.adoptShelfBook(book.shelf_id);
    emit("adopted", result.book_id);
  } catch (err) {
    adoptError.value = err instanceof Error ? err.message : "转为在线书失败";
  } finally {
    adopting.value = false;
  }
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="online-modal" role="dialog" aria-modal="true" aria-label="在线书信息">
      <header class="online-modal-head">
        <h2>手机书架 · 在线书</h2>
        <button type="button" class="modal-close" aria-label="关闭" @click="emit('close')">×</button>
      </header>
      <div class="online-modal-body">
        <div class="online-head">
          <span class="online-cover">
            <img
              v-if="book.cover_url || book.cover_thumb_url"
              :src="book.cover_url || book.cover_thumb_url || ''"
              :alt="book.name"
              draggable="false"
            />
            <span v-else>{{ book.name.slice(0, 2) }}</span>
          </span>
          <div class="online-meta">
            <strong class="online-name">{{ book.name }}</strong>
            <span>{{ book.author || "佚名" }}</span>
            <span v-if="book.source_name">书源：{{ book.source_name }}</span>
            <span v-if="book.latest_chapter">最新：{{ book.latest_chapter }}</span>
            <span v-if="book.dur_chapter_title">读到：{{ book.dur_chapter_title }}</span>
            <span v-if="book.read_at">时间：{{ fmtReadAt(book.read_at) }}</span>
          </div>
        </div>
        <p class="online-intro">{{ book.full_intro || book.intro || "暂无简介" }}</p>
        <div class="online-notice">
          这本书只在手机 Legado 书架里，服务端还没有登记。转为在线书后即可在本端阅读：
          打开时从原书源按需加载目录与正文，需要对应书源已导入服务端。
        </div>
        <p v-if="adoptError" class="online-adopt-error">{{ adoptError }}</p>
      </div>
      <footer class="online-modal-foot">
        <a
          v-if="book.book_url"
          :href="book.book_url"
          target="_blank"
          rel="noopener noreferrer"
          class="ghost-btn source-link"
        >打开源站 ↗</a>
        <button
          type="button"
          class="primary-btn"
          :disabled="adopting || !book.shelf_id"
          @click="adopt"
        >{{ adopting ? "正在登记…" : "转为在线书并阅读" }}</button>
        <button type="button" class="ghost-btn" @click="emit('close')">知道了</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgba(12, 16, 24, 0.5);
}

.online-modal {
  width: min(480px, calc(100vw - 48px));
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg, 0 18px 48px rgba(0, 0, 0, 0.28));
  overflow: hidden;
}

.online-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
}

.online-modal-head h2 {
  margin: 0;
  font-size: 15px;
  color: var(--color-text);
}

.modal-close {
  border: none;
  background: transparent;
  color: var(--color-text-3);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.online-modal-body {
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.online-head {
  display: flex;
  gap: 14px;
}

.online-cover {
  flex: none;
  width: 82px;
  height: 110px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-surface-2);
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}

.online-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.online-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
  color: var(--color-text-2);
}

.online-name {
  font-size: 15px;
  color: var(--color-text);
  margin-bottom: 4px;
}

.online-intro {
  margin: 0;
  max-height: 140px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.65;
  color: var(--color-text-2);
}

.online-notice {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-2);
}

.online-adopt-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #c23a3a;
}

.online-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--color-border);
}

.source-link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}
</style>
