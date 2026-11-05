import { BrowserWindow, app, screen, shell } from "electron";
import path from "node:path";
import { loadConfig, saveConfig } from "./settings-store";

/** 摸鱼：隐藏全部可见窗口（托盘/老板键找回） */
export function hideAllWindows(): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed() && w.isVisible()) w.hide();
  });
}

let mainWindow: BrowserWindow | null = null;

/** 真·退出标记：托盘"退出"或 app 退出流程中置位，绕过"关闭=最小化到托盘" */
let forceQuit = false;

/** 用户主动退出（托盘菜单等）：置位后 app.quit() 不会被关闭拦截 */
export function requestQuit(): void {
  forceQuit = true;
  app.quit();
}

/** app 级退出流程开始时调用，保证任何退出路径都不被拦截 */
export function markForceQuit(): void {
  forceQuit = true;
}

// —— 阅读模式：独立阅读窗口（主窗口尺寸不变） ——
let readerWindow: BrowserWindow | null = null;
let readerPersistTimer: NodeJS.Timeout | null = null;
let repaintTimer: NodeJS.Timeout | null = null;
let readerShowTimer: NodeJS.Timeout | null = null;
let readerReadyShown = false;

/**
 * 渲染进程首帧就绪（设置已加载、路由已渲染）后再显示阅读窗口，
 * 避免"先显示半成品（标题栏闪烁/白屏卡顿）再刷新"的观感
 */
export function markReaderReady(): void {
  if (readerReadyShown) return;
  readerReadyShown = true;
  if (readerShowTimer) {
    clearTimeout(readerShowTimer);
    readerShowTimer = null;
  }
  if (!readerWindow || readerWindow.isDestroyed()) return;
  console.log("[reader] renderer ready, showing window");
  readerWindow.show();
  readerWindow.focus();
  forceRepaint(readerWindow);
}

/** Windows 透明窗口专用：尺寸变化后强制整窗重绘。
 * 透明无边框窗口 resize 后新暴露区域不会被自动重绘（残留旧画面/空白），
 * 必须 invalidate 强制合成器全量重绘 */
function forceRepaint(win?: BrowserWindow | null): void {
  try {
    (win ?? mainWindow)?.webContents.invalidate();
  } catch {
    // 忽略
  }
}

function scheduleRepaint(win?: BrowserWindow | null): void {
  if (repaintTimer) clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => forceRepaint(win), 60);
}

// —— 双击隐藏：Windows 鼠标轮询判定 ——
// 实证结论：drag 区的点击由 Chromium 内部（StartSystemMove）处理，
// 既不产生窗口消息（hookWindowMessage 收不到 NCLBUTTONDOWN/DBLCLK），
// 也不派发 DOM 事件，因此只能轮询按键状态 + 光标位置来判定双击。
import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const GetAsyncKeyState = user32.func("short __stdcall GetAsyncKeyState(int nVirtKey)");
const GetDoubleClickTime = user32.func("uint __stdcall GetDoubleClickTime()");
const GetForegroundWindow = user32.func("intptr __stdcall GetForegroundWindow()");
const GetSystemMetrics = user32.func("int __stdcall GetSystemMetrics(int nIndex)");

const SM_CXDOUBLECLK = 36;
const SM_CYDOUBLECLK = 37;
const VK_LBUTTON = 0x01;
/** 滚轮窗口消息（drag 区吞 DOM 滚轮，主进程钩它转发渲染进程） */
const WM_MOUSEWHEEL = 0x020a;

/** 双击触发冷却，避免连续命中 */
let lastCaptionDblClickAt = 0;

function handleCaptionDoubleClick(win: BrowserWindow): void {
  const now = Date.now();
  if (now - lastCaptionDblClickAt < 800) return;
  lastCaptionDblClickAt = now;
  const hide = loadConfig().boss.doubleClickHide;
  console.log("[reader] caption dblclick, doubleClickHide =", hide);
  if (hide) {
    hideAllWindows();
  } else {
    win.webContents.send("reader:caption-dblclick");
  }
}

/** 轮询判定状态 */
let mousePollTimer: NodeJS.Timeout | null = null;
let pollBtnDown = false;
let pollDownStartAt = 0;
let pollLastDownAt = 0;
let pollLastDownX = -9999;
let pollLastDownY = -9999;

function stopDoubleClickPolling(): void {
  if (mousePollTimer) clearInterval(mousePollTimer);
  mousePollTimer = null;
}

function startDoubleClickPolling(): void {
  if (mousePollTimer) return;
  const dblTime = GetDoubleClickTime();
  const rangeX = Math.max(4, GetSystemMetrics(SM_CXDOUBLECLK));
  const rangeY = Math.max(4, GetSystemMetrics(SM_CYDOUBLECLK));

  mousePollTimer = setInterval(() => {
    const win = readerWindow;
    if (!win || win.isDestroyed()) {
      stopDoubleClickPolling();
      return;
    }
    if (!win.isVisible()) {
      pollBtnDown = false;
      return;
    }
    const down = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0;
    if (!down) {
      // 松开：若按住超过 350ms 视为拖拽/长按，重置双击序列
      if (pollBtnDown && Date.now() - pollDownStartAt > 350) {
        pollLastDownAt = 0;
      }
      pollBtnDown = false;
      return;
    }
    if (pollBtnDown) return; // 按住中，只在按下沿判定
    pollBtnDown = true;
    pollDownStartAt = Date.now();

    // 光标必须落在阅读窗口内，且窗口在前台（排除点到被遮挡区域的情况）
    const pt = screen.getCursorScreenPoint();
    const b = win.getBounds();
    if (pt.x < b.x || pt.x >= b.x + b.width || pt.y < b.y || pt.y >= b.y + b.height) return;
    const fg = GetForegroundWindow();
    let fgIsReader = win.isFocused();
    if (!fgIsReader) {
      const handle = win.getNativeWindowHandle();
      if (handle.length >= 8) {
        fgIsReader = handle.readBigInt64LE(0) === BigInt(fg);
      }
    }
    if (!fgIsReader) return;

    const now = Date.now();
    const near =
      Math.abs(pt.x - pollLastDownX) < rangeX && Math.abs(pt.y - pollLastDownY) < rangeY;
    if (pollLastDownAt > 0 && now - pollLastDownAt <= dblTime && near) {
      pollLastDownAt = 0;
      handleCaptionDoubleClick(win);
    } else {
      pollLastDownAt = now;
      pollLastDownX = pt.x;
      pollLastDownY = pt.y;
    }
  }, 20);
}

/** 高度下限放得较低：真实下限由渲染层按整行对齐（3 行）决定 */
const READER_MIN = { width: 220, height: 100 };

/**
 * 打开独立阅读窗口：按阅读器专属尺寸直接新建 BrowserWindow（主窗口不变尺寸、暂时隐藏），
 * 从结构上避免透明窗口 resize 的重绘残留。关闭时恢复主窗口。
 */
export function openReaderWindow(bookId?: string | number): boolean {
  if (readerWindow && !readerWindow.isDestroyed()) {
    readerWindow.show();
    readerWindow.focus();
    return true;
  }
  const cfg = loadConfig().readerWindow;
  readerWindow = new BrowserWindow({
    width: cfg.width,
    height: cfg.height,
    minWidth: READER_MIN.width,
    minHeight: READER_MIN.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    title: "iNovel",
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // 整页是原生拖拽区；双击隐藏由主进程鼠标轮询判定（见 startDoubleClickPolling）
  readerWindow.setMaximizable(false);
  startDoubleClickPolling();
  readerWindow.setSkipTaskbar(loadConfig().boss.skipTaskbar);

  // 滚轮滚动：drag 区会吞掉 DOM 滚轮事件（渲染进程收不到），但 WM_MOUSEWHEEL
  // 窗口消息能到达钩子。主进程解析增量与光标位置后用 sendInputEvent 注入渲染
  // 进程，可正常驱动 .reader-surface 滚动（已实证）。
  if (process.platform === "win32") {
    try {
      readerWindow.hookWindowMessage(WM_MOUSEWHEEL, (wParam, lParam) => {
        const win = readerWindow;
        if (!win || win.isDestroyed() || !win.isVisible()) return;
        const delta = (wParam as Buffer).readInt16LE(2);
        const lp = (lParam as Buffer).readUInt32LE(0);
        let sx = lp & 0xffff;
        let sy = (lp >>> 16) & 0xffff;
        if (sx > 32767) sx -= 65536;
        if (sy > 32767) sy -= 65536;
        // lParam 是物理像素坐标，转 DIP 后减窗口原点得内容坐标
        const dip = screen.screenToDipPoint({ x: sx, y: sy });
        const b = win.getBounds();
        win.webContents.sendInputEvent({
          type: "mouseWheel",
          x: Math.round(dip.x - b.x),
          y: Math.round(dip.y - b.y),
          deltaX: 0,
          deltaY: delta,
        });
      });
    } catch {
      // 钩子失败时滚轮降级不可用
    }
  }

  // 阅读器尺寸变化：强制重绘 + 防抖持久化
  readerWindow.on("resize", () => {
    scheduleRepaint(readerWindow);
    if (readerPersistTimer) clearTimeout(readerPersistTimer);
    readerPersistTimer = setTimeout(() => {
      if (!readerWindow || readerWindow.isDestroyed()) return;
      const bounds = readerWindow.getBounds();
      try {
        saveConfig({ readerWindow: { width: bounds.width, height: bounds.height } });
      } catch {
        // 忽略
      }
    }, 400);
  });

  // 阅读窗口渲染进程日志转发到主进程终端，便于诊断独立窗口内的路由/会话问题
  readerWindow.webContents.on("console-message", (_e, _level, message) => {
    console.log(`[reader:console] ${message}`);
  });
  readerWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[reader] renderer gone:", details.reason);
  });

  // 关闭：记住尺寸、停止轮询、把主窗口带回来
  readerWindow.on("closed", () => {
    console.log("[reader] window closed");
    stopDoubleClickPolling();
    if (readerShowTimer) {
      clearTimeout(readerShowTimer);
      readerShowTimer = null;
    }
    readerReadyShown = false;
    readerWindow = null;
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      // 通知书库等页面刷新阅读进度（读完后主界面立即显示最新进度）
      main.webContents.send("library:refresh");
      main.show();
      main.focus();
      forceRepaint(main);
    }
  });

  const hash = `books/${bookId ?? "demo"}/read`;
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const loadPromise = devServerUrl
    ? readerWindow.loadURL(`${devServerUrl}#${hash}`)
    : readerWindow.loadFile(path.join(__dirname, "../dist/index.html"), { hash });
  readerWindow.once("ready-to-show", () => {
    console.log("[reader] ready-to-show (waiting renderer ready signal)");
    // 兜底：渲染进程 2.5 秒内没发就绪信号（异常情况）也显示窗口，避免"点了没反应"
    readerShowTimer = setTimeout(() => {
      console.log("[reader] fallback show (no ready signal)");
      markReaderReady();
    }, 2500);
  });
  // 加载失败也要把窗口显示出来，避免"点了没反应"（主窗口已隐藏）
  void loadPromise.catch((err) => {
    console.error("[reader] load failed:", err);
    readerWindow?.show();
  });

  // 阅读时隐藏主窗口，避免双窗口干扰
  const main = getMainWindow();
  if (main && !main.isDestroyed()) main.hide();
  return true;
}

/** 关闭独立阅读窗口（Esc / 双击后由渲染进程触发） */
export function closeReaderWindow(): boolean {
  if (!readerWindow || readerWindow.isDestroyed()) return false;
  readerWindow.close();
  return true;
}

/**
 * 阅读器右下角手柄拖拽：直接改窗口尺寸（左上角锚定），
 * 让窗口边界始终等于正文边界——截图/捕获不再出现窗口内大片空白。
 */
export function resizeReaderWindow(width: number, height: number): boolean {
  if (!readerWindow || readerWindow.isDestroyed()) return false;
  const { workArea } = screen.getDisplayMatching(readerWindow.getBounds());
  const w = Math.round(Math.min(workArea.width, Math.max(READER_MIN.width, width)));
  const h = Math.round(Math.min(workArea.height, Math.max(READER_MIN.height, height)));
  readerWindow.setSize(w, h);
  return true;
}

/** 阅读窗口是否打开 */
export function isReaderOpen(): boolean {
  return !!readerWindow && !readerWindow.isDestroyed();
}

/** 阅读窗口引用（未打开返回 null） */
export function getReaderWindow(): BrowserWindow | null {
  return readerWindow && !readerWindow.isDestroyed() ? readerWindow : null;
}

/** 找回阅读窗口（老板键在阅读模式下使用） */
export function showReaderWindow(): boolean {
  if (!readerWindow || readerWindow.isDestroyed()) return false;
  readerWindow.show();
  readerWindow.focus();
  return true;
}

/** 图标资源位置：dev 与打包后（asar 内）统一从 app 根取 */
export function getIconPath(): string {
  return path.join(app.getAppPath(), "build", "icon.ico");
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** 托盘/老板键找回窗口：阅读模式下优先找回阅读窗口（与老板键行为一致） */
export function showMainWindow(): void {
  if (isReaderOpen()) {
    if (showReaderWindow()) return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

/**
 * 无边框 + 透明窗口；窗口尺寸/最大化状态持久化到 config.json。
 * 阅读模式下的标题栏隐藏由渲染进程路由 meta 控制。
 */
export function createMainWindow(): BrowserWindow {
  const windowCfg = loadConfig().window;
  mainWindow = new BrowserWindow({
    width: windowCfg.width,
    height: windowCfg.height,
    minWidth: 860,
    minHeight: 560,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    title: "iNovel",
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 透明窗口被遮挡/失焦时 Chromium 会节流绘制，导致画面残留，关闭之
      backgroundThrottling: false,
    },
  });
  if (windowCfg.maximized) mainWindow.maximize();

  // 任何尺寸变化（用户拖边框等）后强制重绘，防止透明窗口残留旧画面
  mainWindow.on("resize", () => scheduleRepaint(mainWindow));

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // 禁止把外部页面加载进应用窗口；http/https 链接交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL() || "";
    if (url !== current) event.preventDefault();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    // 开发期把渲染进程控制台转发到终端，方便排查 UI 异常
    mainWindow.webContents.on("console-message", (_e, level, message) => {
      if (level >= 2) console.log(`[renderer:${level}]`, message);
    });
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // 关闭前持久化窗口状态，不阻塞退出流程；
  // 「关闭=最小化到托盘」模式下拦截关闭，仅隐藏窗口（托盘/老板键找回，真退出走托盘菜单）
  mainWindow.on("close", (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      saveConfig({
        window: {
          width: mainWindow.getBounds().width,
          height: mainWindow.getBounds().height,
          maximized: mainWindow.isMaximized(),
          closeAction: loadConfig().window.closeAction,
        },
      });
    } catch {
      // 写入失败不阻塞关闭
    }
    if (!forceQuit && loadConfig().window.closeAction === "minimize") {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}
