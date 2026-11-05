import { execFile } from "node:child_process";
import { app, BrowserWindow, globalShortcut, ipcMain, session } from "electron";
import { ApiClient, ApiError, normalizeServerUrl, testConnection } from "./api-client";
import { clearPassword, clearToken, loadPassword, savePassword } from "./session-store";
import {
  loadConfig,
  loadProgress,
  saveConfig,
  saveProgressLocal,
  type LocalProgress,
} from "./settings-store";
import {
  closeReaderWindow,
  createMainWindow,
  getMainWindow,
  getReaderWindow,
  isReaderOpen,
  markForceQuit,
  markReaderReady,
  openReaderWindow,
  resizeReaderWindow,
  showMainWindow,
  showReaderWindow,
} from "./window";
import { destroyTray, ensureTray } from "./tray";

/** 401 时主进程主动通知渲染进程回到登录页 */
const client = new ApiClient(() => {
  getMainWindow()?.webContents.send("session:expired");
});

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "未知错误";
}

// —— Windows 已安装字体列表（读注册表，避免引入原生依赖） ——

const FONT_REG_KEYS = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
  "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
];

let fontsCache: string[] | null = null;

function regQueryLines(key: string): Promise<string[]> {
  return new Promise((resolve) => {
    // EPERM 等沙箱拦截可能同步抛出，必须捕获
    try {
      execFile("reg", ["query", key], { windowsHide: true }, (err, stdout) => {
        resolve(err || !stdout ? [] : stdout.split(/\r?\n/));
      });
    } catch {
      resolve([]);
    }
  });
}

/** "Microsoft YaHei & Microsoft YaHei UI (TrueType)  REG_SZ  msyh.ttc" → ["Microsoft YaHei", "Microsoft YaHei UI"] */
function cleanFontName(raw: string): string[] {
  const name = raw.split("REG_SZ")[0].trim();
  const cleaned = name.replace(/\s*\((TrueType|OpenType)[^)]*\)\s*$/i, "").trim();
  if (!cleaned) return [];
  return cleaned
    .split("&")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function listSystemFonts(): Promise<string[]> {
  if (fontsCache) return fontsCache;
  const lines = (await Promise.all(FONT_REG_KEYS.map(regQueryLines))).flat();
  const seen = new Set<string>();
  const fonts: string[] = [];
  for (const line of lines) {
    if (!line.includes("REG_SZ")) continue;
    for (const name of cleanFontName(line)) {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        fonts.push(name);
      }
    }
  }
  fonts.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  fontsCache = fonts;
  console.log(`[fonts] registry fallback loaded ${fonts.length} fonts`);
  return fonts;
}

// 允许渲染进程使用 Chromium Local Font Access（navigator.queryLocalFonts）
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    // 应用只加载自家页面，全部放行（含 localFonts）
    callback(true);
  });
});

// —— 摸鱼：老板键 / 隐藏窗口 ——

/** 老板键显示/隐藏切换：阅读模式下只作用于阅读窗口，普通模式只作用于主窗口，
 *  避免"同时显示主界面和阅读器"的串台 */
function toggleMainWindow(): void {
  if (isReaderOpen()) {
    const reader = getReaderWindow();
    if (!reader) return;
    if (reader.isVisible() && !reader.isMinimized()) reader.hide();
    else showReaderWindow();
    return;
  }
  const main = getMainWindow();
  if (!main) return;
  if (main.isVisible() && !main.isMinimized()) main.hide();
  else showMainWindow();
}

/** "Ctrl+Alt+Q" → Electron accelerator "Control+Alt+Q" */
function normalizeAccelerator(input: string): string {
  return input
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl") return "Control";
      if (lower === "cmd" || lower === "command") return "Command";
      if (lower === "win" || lower === "super" || lower === "meta") return "Super";
      if (lower === "esc") return "Escape";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("+");
}

/** 应用摸鱼设置：托盘、任务栏图标、全局老板键（启动与设置变更时调用） */
function applyBossSettings(): void {
  const boss = loadConfig().boss;
  ensureTray();
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.setSkipTaskbar(boss.skipTaskbar);
  // 阅读窗口同样应用任务栏隐藏设置
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed() && w !== win) w.setSkipTaskbar(boss.skipTaskbar);
  });

  globalShortcut.unregisterAll();
  const shortcut = boss.toggleShortcut.trim();
  if (shortcut) {
    try {
      const ok = globalShortcut.register(normalizeAccelerator(shortcut), toggleMainWindow);
      if (!ok) console.warn(`老板键注册失败（可能被其他应用占用）：${shortcut}`);
    } catch (err) {
      console.warn(`老板键注册异常：${(err as Error).message}`);
    }
  }
}

function registerIpc(): void {
  // —— 窗口控制（无边框窗口的按钮与拖拽区域） ——
  ipcMain.handle("windowControl", (event, action: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (action === "minimize") win.minimize();
    else if (action === "maximize") {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === "close") win.close();
    return win.isMaximized();
  });

  // 沉浸阅读：整页为原生拖拽区（-webkit-app-region: drag，由 OS 搬移窗口），
  // 双击隐藏通过 window.ts 的 WM_NCLBUTTONDBLCLK 钩子转发，不再程序化移动窗口

  // 阅读窗口：独立 BrowserWindow，按阅读器尺寸直接创建（主窗口不变尺寸）
  ipcMain.handle("readerWindow:enter", (_e, bookId?: string | number) => {
    console.log("[reader] enter requested, bookId =", bookId);
    try {
      const ok = openReaderWindow(bookId);
      console.log("[reader] openReaderWindow returned", ok);
      return ok;
    } catch (err) {
      console.error("[reader] openReaderWindow failed:", err);
      return false;
    }
  });
  ipcMain.handle("readerWindow:exit", () => {
    console.log("[reader] exit requested");
    return closeReaderWindow();
  });

  // 阅读器手柄拖拽：直接缩放阅读窗口本身（窗口边界=正文边界）
  ipcMain.handle("readerWindow:resize", (_e, width: number, height: number) => {
    return resizeReaderWindow(width, height);
  });

  // 阅读窗口渲染进程首帧就绪：此时再显示窗口（避免标题栏闪烁/加载卡顿观感）
  ipcMain.on("readerWindow:ready", () => markReaderReady());

  // 摸鱼：阅读区双击隐藏窗口（找回：托盘图标 / 老板键）
  ipcMain.handle("boss:hide", () => {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed() && w.isVisible()) w.hide();
    });
    return { ok: true };
  });

  ipcMain.handle("app:version", () => app.getVersion());

  // —— 连接与登录 ——
  ipcMain.handle("testConnection", (_e, serverUrl: string) => testConnection(serverUrl));

  ipcMain.handle(
    "login",
    async (_e, serverUrl: string, username: string, password: string, remember?: boolean) => {
      try {
        const base = normalizeServerUrl(serverUrl ?? "");
        const name = (username ?? "").trim();
        if (!name) throw new ApiError(0, "请输入用户名");
        if (!password) throw new ApiError(0, "请输入密码");

        // 临时写入 serverUrl 供请求使用，失败则还原
        const previous = loadConfig();
        saveConfig({ serverUrl: base, username: name });
        try {
          await client.login(name, password);
        } catch (err) {
          saveConfig({ serverUrl: previous.serverUrl, username: previous.username });
          throw err;
        }
        // 记住密码：DPAPI 加密保存；不勾选则清除已存密码
        if (remember) await savePassword(password);
        else clearPassword();
        return { ok: true, serverUrl: base, username: name };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle("getSavedCredentials", async () => {
    const config = loadConfig();
    const password = await loadPassword();
    return { username: config.username, password };
  });

  ipcMain.handle("logout", () => {
    clearToken();
    clearPassword();
    return { ok: true };
  });

  ipcMain.handle("authMe", async () => {
    try {
      const data = await client.me();
      console.log("[auth] me ok");
      return { ok: true, data };
    } catch (err) {
      console.log("[auth] me failed:", errorMessage(err));
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  // —— 书库与内容 ——
  ipcMain.handle("getBooks", async (_e, params?: Record<string, string | number | boolean>) => {
    try {
      return { ok: true, data: await client.getBooks(params) };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle("getBook", async (_e, bookId: number) => {
    try {
      return { ok: true, data: await client.getBook(bookId) };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    "getToc",
    async (_e, bookId: number, page?: number, pageSize?: number) => {
      try {
        return { ok: true, data: await client.getToc(bookId, page, pageSize) };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle("getChapter", async (_e, bookId: number, chapterId: number) => {
    try {
      return { ok: true, data: await client.getChapter(bookId, chapterId) };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  // —— 进度：服务端写回 + 本地进度文件 ——
  ipcMain.handle(
    "saveProgress",
    async (_e, bookId: number, data: { percent: number; chapter_index: number }) => {
      try {
        const result = await client.saveProgress(bookId, data);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle("saveLocalProgress", (_e, data: LocalProgress) => {
    try {
      saveProgressLocal(data);
      return { ok: true };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle("loadLocalProgress", (_e, bookId: number) => {
    return loadProgress(bookId);
  });

  // —— Legado WebDAV 同步 ——
  ipcMain.handle("pullLegadoProgress", async (_e, bookId: number, data?: unknown) => {
    try {
      return { ok: true, data: await client.pullLegado(bookId, data) };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle("pushLegadoProgress", async (_e, bookId: number, data?: unknown) => {
    try {
      return { ok: true, data: await client.pushLegado(bookId, data) };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  // —— 设置 ——
  ipcMain.handle("getSettings", () => loadConfig());

  // Windows 已安装字体列表（注册表读取，进程内缓存）
  ipcMain.handle("fonts:list", () => listSystemFonts());

  ipcMain.handle("setSettings", (_e, patch: Record<string, unknown>) => {
    const config = saveConfig(patch);
    if (patch && typeof patch === "object" && "boss" in patch) applyBossSettings();
    return config;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();
  applyBossSettings();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("before-quit", () => {
  markForceQuit();
  globalShortcut.unregisterAll();
  destroyTray();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
