<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import TitleBar from "@/components/TitleBar.vue";
import { useSessionStore } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const immersive = computed(() => route.meta.immersive === true);
/** 路由未就绪时 route 还是初始占位（非沉浸），此时渲染标题栏会在阅读窗口首帧闪一下 */
const routerReady = ref(false);
void router.isReady().then(() => (routerReady.value = true));

/** 最大化时收起外壳的外边距/圆角/投影（.is-max） */
const isMax = ref(false);

function updateMaxState(): void {
  isMax.value =
    window.innerWidth >= screen.availWidth - 4 &&
    window.innerHeight >= screen.availHeight - 4;
}

// 主进程在任意 API 返回 401 时通知；Token 过期统一回登录页
onMounted(() => {
  updateMaxState();
  window.addEventListener("resize", updateMaxState);
  window.api.onSessionExpired(() => {
    session.authed = false;
    void router.push({ name: "login" });
  });
});
onUnmounted(() => window.removeEventListener("resize", updateMaxState));
</script>

<template>
  <div class="app-shell" :class="{ 'is-immersive': immersive, 'is-max': isMax && !immersive }">
    <TitleBar v-if="routerReady && !immersive" />
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>
