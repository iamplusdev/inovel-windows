import { contextBridge, ipcRenderer } from "electron";

/**
 * 白名单 IPC；server API、Token、文件读写都只在主进程完成。
 * 方法名与 DESIGN.md §9 保持一致，另加本地进度与连接测试辅助方法。
 */
contextBridge.exposeInMainWorld("api", {
  window: {
    minimize: () => ipcRenderer.invoke("windowControl", "minimize"),
    maximize: () => ipcRenderer.invoke("windowControl", "maximize"),
    close: () => ipcRenderer.invoke("windowControl", "close"),
    onCaptionDblClick: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("reader:caption-dblclick", listener);
      return () => ipcRenderer.removeListener("reader:caption-dblclick", listener);
    },
    enterReader: (bookId?: string | number) =>
      ipcRenderer.invoke("readerWindow:enter", bookId),
    exitReader: () => ipcRenderer.invoke("readerWindow:exit"),
    readerResize: (width: number, height: number) =>
      ipcRenderer.invoke("readerWindow:resize", width, height),
    readerReady: () => ipcRenderer.send("readerWindow:ready"),
  },
  app: {
    version: () => ipcRenderer.invoke("app:version"),
  },
  boss: {
    hide: () => ipcRenderer.invoke("boss:hide"),
  },
  login: (serverUrl: string, username: string, password: string, remember?: boolean) =>
    ipcRenderer.invoke("login", serverUrl, username, password, remember),
  getSavedCredentials: () => ipcRenderer.invoke("getSavedCredentials"),
  logout: () => ipcRenderer.invoke("logout"),
  authMe: () => ipcRenderer.invoke("authMe"),
  testConnection: (serverUrl: string) => ipcRenderer.invoke("testConnection", serverUrl),
  getBooks: (params?: Record<string, string | number | boolean>) =>
    ipcRenderer.invoke("getBooks", params),
  getBook: (bookId: number) => ipcRenderer.invoke("getBook", bookId),
  getToc: (bookId: number, page?: number, pageSize?: number) =>
    ipcRenderer.invoke("getToc", bookId, page, pageSize),
  getChapter: (bookId: number, chapterId: number) =>
    ipcRenderer.invoke("getChapter", bookId, chapterId),
  saveProgress: (bookId: number, data: { percent: number; chapter_index: number }) =>
    ipcRenderer.invoke("saveProgress", bookId, data),
  saveLocalProgress: (data: unknown) => ipcRenderer.invoke("saveLocalProgress", data),
  loadLocalProgress: (bookId: number) => ipcRenderer.invoke("loadLocalProgress", bookId),
  pullLegadoProgress: (bookId: number, data?: unknown) =>
    ipcRenderer.invoke("pullLegadoProgress", bookId, data),
  pushLegadoProgress: (bookId: number, data?: unknown) =>
    ipcRenderer.invoke("pushLegadoProgress", bookId, data),
  getSettings: () => ipcRenderer.invoke("getSettings"),
  setSettings: (patch: unknown) => ipcRenderer.invoke("setSettings", patch),
  listFonts: () => ipcRenderer.invoke("fonts:list"),
  onSessionExpired: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("session:expired", listener);
    return () => ipcRenderer.removeListener("session:expired", listener);
  },
  onLibraryRefresh: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("library:refresh", listener);
    return () => ipcRenderer.removeListener("library:refresh", listener);
  },
});
