<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSessionStore } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
// 登录页不提供设置入口（尚未登录，无可配置项）
const isLogin = computed(() => route.name === "login");
/** 登录后显示统一导航：书库 / 设置 */
const showNav = computed(() => session.authed);

const isLibraryArea = computed(() => route.name === "library" || route.name === "book-detail");

function goLibrary() {
  if (isLogin.value) return;
  void router.push({ name: "library" });
}

function goSettings() {
  void router.push({ name: "settings" });
}

function minimize() {
  void window.api.window.minimize();
}

function maximize() {
  void window.api.window.maximize();
}

function close() {
  void window.api.window.close();
}
</script>

<template>
  <header class="titlebar">
    <button class="brand" type="button" :disabled="isLogin" @click="goLibrary">
      <img class="brand-icon" src="/favicon.ico" alt="iNovel" draggable="false" />
      <span class="brand-name">iNovel</span>
    </button>
    <nav v-if="showNav" class="nav">
      <button
        type="button"
        class="nav-link"
        :class="{ 'is-active': isLibraryArea }"
        @click="goLibrary"
      >
        书库
      </button>
      <button
        type="button"
        class="nav-link"
        :class="{ 'is-active': route.name === 'settings' }"
        @click="goSettings"
      >
        设置
      </button>
    </nav>
    <div class="drag-region" />
    <div class="title-actions">
      <button type="button" class="win-btn" title="最小化" @click="minimize">−</button>
      <button type="button" class="win-btn" title="最大化" @click="maximize">□</button>
      <button type="button" class="win-btn is-close" title="关闭" @click="close">×</button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.brand-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  object-fit: contain;
  user-select: none;
}

.brand-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.brand:disabled {
  cursor: default;
}

/* 统一页面导航：与品牌区齐排，激活态用药丸底色 */
.nav {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 8px;
  -webkit-app-region: no-drag;
}

.nav-link {
  height: 26px;
  padding: 0 13px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-2);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-link:hover {
  background: var(--color-surface-2);
  color: var(--color-text);
}

.nav-link.is-active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 600;
}

.drag-region {
  flex: 1;
  -webkit-app-region: drag;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  -webkit-app-region: no-drag;
}

.win-btn {
  height: 100%;
  width: 42px;
  border: none;
  background: transparent;
  color: var(--color-text-2);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
}

.win-btn:hover {
  background: var(--color-surface-2);
  color: var(--color-text);
}

.win-btn.is-close:hover {
  background: #d94b4b;
  color: #fff;
}
</style>
