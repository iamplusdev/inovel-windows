<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { bridge } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";

const router = useRouter();
const session = useSessionStore();

const serverUrl = ref(session.serverUrl || "http://127.0.0.1:7311");
const username = ref(session.username || "");
const password = ref("");
const remember = ref(false);
const notice = ref("");
const noticeKind = ref<"info" | "error" | "ok">("info");
const loading = ref(false);
const testing = ref(false);
const version = ref("");

onMounted(async () => {
  version.value = await window.api.app.version();
  // 预填充已保存的凭据（密码为 DPAPI 加密存储，此处解密回填）
  try {
    const saved = await bridge.getSavedCredentials();
    if (saved.username) username.value = saved.username;
    if (saved.password) {
      password.value = saved.password;
      remember.value = true;
    }
  } catch {
    // 忽略读取失败
  }
});

function setNotice(text: string, kind: "info" | "error" | "ok" = "info") {
  notice.value = text;
  noticeKind.value = kind;
}

async function onTestConnection() {
  if (testing.value) return;
  testing.value = true;
  setNotice("正在连接服务器…");
  try {
    const result = await bridge.testConnection(serverUrl.value);
    setNotice(result.message, result.online ? (result.initialized === false ? "error" : "ok") : "error");
  } finally {
    testing.value = false;
  }
}

async function onConnect(event: Event) {
  event.preventDefault();
  if (loading.value) return;
  loading.value = true;
  setNotice("正在登录…");
  try {
    const result = await bridge.login(
      serverUrl.value,
      username.value,
      password.value,
      remember.value,
    );
    if (result.ok && result.serverUrl && result.username) {
      session.applyLogin(result.serverUrl, result.username);
      password.value = "";
      void router.push({ name: "library" });
    } else {
      setNotice(result.error || "登录失败", "error");
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <form class="login-card" @submit="onConnect">
      <div class="brand">
        <img class="brand-mark" src="/favicon.ico" alt="" draggable="false" />
        <div>
          <h1>iNovel</h1>
          <p class="muted-xs">Windows 小说阅读器 · v{{ version }}</p>
        </div>
      </div>

      <label class="field">
        <span class="field-label">服务器地址</span>
        <input
          v-model="serverUrl"
          class="field-input"
          placeholder="http://192.168.1.100:7311"
          autocomplete="url"
        />
      </label>
      <label class="field">
        <span class="field-label">用户名</span>
        <input v-model="username" class="field-input" autocomplete="username" />
      </label>
      <label class="field">
        <span class="field-label">密码</span>
        <input
          v-model="password"
          type="password"
          class="field-input"
          autocomplete="current-password"
        />
      </label>

      <label class="remember-row">
        <input v-model="remember" type="checkbox" />
        <span>记住密码</span>
        <span class="muted-xs remember-note">使用 Windows DPAPI 加密存储</span>
      </label>

      <div class="actions">
        <button type="submit" class="primary-btn" :disabled="loading">
          {{ loading ? "登录中…" : "登录" }}
        </button>
        <button type="button" class="ghost-btn" :disabled="testing" @click="onTestConnection">
          {{ testing ? "测试中…" : "测试连接" }}
        </button>
      </div>

      <p v-if="notice" class="notice muted-xs" :class="`is-${noticeKind}`">{{ notice }}</p>
      <p class="muted-xs footnote">
        省略协议时默认使用 http://。Token 与记住的密码均由 Windows DPAPI 加密保存。
      </p>
    </form>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 32px;
  background: radial-gradient(900px 480px at 18% -10%, var(--color-accent-soft), transparent 62%),
    radial-gradient(720px 420px at 105% 110%, var(--color-accent-soft), transparent 58%);
}

.login-card {
  width: min(400px, 100%);
  padding: 30px 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  object-fit: contain;
  user-select: none;
}

h1 {
  margin: 0;
  font-size: 20px;
}

.remember-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-2);
  cursor: pointer;
  user-select: none;
}

.remember-row input {
  accent-color: var(--color-accent);
}

.remember-note {
  margin-left: auto;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.actions button:disabled {
  opacity: 0.6;
  cursor: default;
}

.notice {
  margin: 0;
}

.notice.is-ok {
  color: #1f9d63;
}

.notice.is-error {
  color: var(--color-danger);
}

.notice.is-info {
  color: var(--color-text-3);
}

.footnote {
  margin: 2px 0 0;
  line-height: 1.6;
}
</style>
