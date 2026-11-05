import { createRouter, createWebHashHistory } from "vue-router";
import { useSessionStore } from "@/stores/session";

const router = createRouter({
  // Electron 打包后是 file://，使用 hash 路由避免刷新丢路径
  history: createWebHashHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
      meta: { title: "连接服务器" },
    },
    {
      path: "/",
      name: "library",
      component: () => import("@/views/LibraryView.vue"),
      meta: { title: "书库" },
    },
    {
      path: "/books/:id",
      name: "book-detail",
      component: () => import("@/views/BookDetailView.vue"),
      meta: { title: "书籍详情" },
    },
    {
      path: "/books/:id/read",
      name: "reader",
      component: () => import("@/views/ReaderView.vue"),
      meta: { title: "阅读", immersive: true },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("@/views/SettingsView.vue"),
      meta: { title: "设置" },
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

// 登录守卫：启动时先恢复会话（校验 /api/auth/me），未登录一律回登录页
router.beforeEach(async (to, from) => {
  const session = useSessionStore();
  if (!session.ready) await session.init();
  if (to.name !== "login" && !session.authed) {
    // 独立阅读窗口冷启动时未登录：直接关窗，把登录交还给主窗口，不在小窗里显示登录页
    if (from.name === undefined && to.name === "reader") {
      void window.api.window.exitReader();
      return false;
    }
    return { name: "login" };
  }
  if (to.name === "login" && session.authed) return { name: "library" };
});

export default router;
