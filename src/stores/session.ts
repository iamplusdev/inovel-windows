import { defineStore } from "pinia";
import { bridge } from "@/api/bridge";

/**
 * 会话状态：Token 保存在主进程（safeStorage 加密），渲染进程只持有
 * 服务器地址、用户名和登录标志。应用启动时通过 /api/auth/me 校验会话。
 */
export const useSessionStore = defineStore("session", {
  state: () => ({
    serverUrl: "",
    username: "",
    authed: false,
    ready: false,
  }),
  actions: {
    async init() {
      if (this.ready) return;
      this.ready = true;
      try {
        const config = await bridge.getSettings();
        this.serverUrl = config.serverUrl || "";
        this.username = config.username || "";
      } catch {
        return;
      }
      if (!this.serverUrl) return;
      try {
        await bridge.authMe();
        this.authed = true;
      } catch {
        this.authed = false;
      }
    },
    applyLogin(serverUrl: string, username: string) {
      this.serverUrl = serverUrl;
      this.username = username;
      this.authed = true;
    },
    async logout() {
      try {
        await bridge.logout();
      } finally {
        this.authed = false;
      }
    },
  },
});
