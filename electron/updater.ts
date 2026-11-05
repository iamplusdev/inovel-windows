import { app, BrowserWindow, dialog, ipcMain, net, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getDataDir, loadConfig, saveConfig } from "./settings-store";

/**
 * GitHub Release 自动更新（主进程）。
 * 借鉴 PushBox UpdateClient 的三条口径：
 *  1. 读 /releases 列表而非 /latest —— 以后若分端发布，latest 可能指向没有 Windows 产物的 Release；
 *  2. 版本号逐段整数比较，预发布后缀不参与；
 *  3. 下载先写 .tmp 再改名，中途被杀不留半个包。
 */

const OWNER = "iamplusdev";
const REPO = "inovel-windows";
const RELEASES_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`;
/** GitHub 无 UA 直接 403，这一句是硬性要求 */
const USER_AGENT = "iNovel-Windows";

/** 更新检查接口超时；下载不限总超时（大文件在慢网上不该被掐断） */
const CHECK_TIMEOUT_MS = 20_000;

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
}

export interface UpdateInfo {
  /** 可比较的三段版本号，如 "0.2.0" */
  version: string;
  tag: string;
  notes: string;
  asset: UpdateAsset;
}

type ProgressPayload = { done: number; total: number; percent: number };

let latestUpdate: UpdateInfo | null = null;
let downloadedPath: string | null = null;
let downloadInFlight = false;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/** "windows-v1.2.3" / "v1.2.3" / "1.2.3" → "1.2.3" */
export function stripTagPrefix(tag: string): string {
  const value = (tag ?? "").trim();
  const lower = value.toLowerCase();
  if (lower.startsWith("windows-v")) return value.slice("windows-v".length);
  if (value.startsWith("v") || value.startsWith("V")) return value.slice(1);
  return value;
}

/** 逐段整数比较：正数=left 更新，0=相同，负数=right 更新；缺段补 0，非数字尾巴只取前导数字 */
export function compareVersion(left: string, right: string): number {
  const split = (v: string): number[] =>
    (v ?? "")
      .split(".")
      .map((seg) => {
        const m = /^(\d+)/.exec(seg ?? "");
        return m ? Number.parseInt(m[1], 10) : 0;
      });
  const a = split(left);
  const b = split(right);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = i < a.length ? a[i] : 0;
    const y = i < b.length ? b[i] : 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** 产物命名约定（CI：electron-builder.yml）：iNovel-{ver}-portable.exe / .zip */
function isPortableAsset(name: string): boolean {
  return /^inovel-[\d.]+-portable\.(exe|zip)$/i.test(name ?? "");
}

/** 拉 releases 列表（跳过 draft/prerelease），返回第一条带本平台产物且新于当前版本的 Release */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const response = await net.fetch(RELEASES_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) {
    const reason =
      response.status === 403 || response.status === 401
        ? "GitHub 接口限流（未认证限额 60 次/小时），稍后再试"
        : response.status === 404
          ? "还没有发布过任何版本"
          : `HTTP ${response.status}`;
    throw new Error(`更新检查失败：${reason}`);
  }
  const releases = (await response.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(releases)) throw new Error("更新检查失败：GitHub 返回的不是 releases 列表");

  for (const release of releases) {
    if (release.draft === true || release.prerelease === true) continue;
    const assets = (release.assets ?? []) as Array<Record<string, unknown>>;
    // 同一 Release 内 exe 优先（单文件可直接运行），zip 兜底
    const pick = (suffix: ".exe" | ".zip"): Record<string, unknown> | undefined =>
      assets.find(
        (a) =>
          isPortableAsset(String(a.name ?? "")) &&
          String(a.name ?? "").toLowerCase().endsWith(suffix) &&
          typeof a.browser_download_url === "string" &&
          a.browser_download_url.length > 0,
      );
    const asset = pick(".exe") ?? pick(".zip");
    if (!asset) continue;

    // 列表按创建时间倒序：第一条带本平台产物的 Release 就是最新的；
    // 它不新于当前版本时，后面更旧，无需继续。
    const version = stripTagPrefix(String(release.tag_name ?? ""));
    if (!version || compareVersion(version, app.getVersion()) <= 0) return null;

    return {
      version,
      tag: String(release.tag_name ?? ""),
      notes: typeof release.body === "string" ? release.body.slice(0, 2000) : "",
      asset: {
        name: String(asset.name),
        url: String(asset.browser_download_url),
        size: typeof asset.size === "number" ? asset.size : 0,
      },
    };
  }
  return null;
}

/** 下载目录：便携版优先放当前 exe 同目录（用户顺手就能替换旧版），不可写回退数据目录 */
function downloadDir(): string {
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portable) {
    try {
      fs.accessSync(portable, fs.constants.W_OK);
      return portable;
    } catch {
      // 便携目录只读，回退
    }
  }
  const dir = path.join(getDataDir(), "updates");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function downloadUpdate(): Promise<string> {
  if (!latestUpdate) throw new Error("还没有可下载的更新（请先检查更新）");
  const info = latestUpdate;
  const dest = path.join(downloadDir(), info.asset.name);
  const temp = `${dest}.tmp`;

  // 下载用单独请求且不限总超时；net.fetch 走 Chromium 网络栈，跟随系统代理
  const response = await net.fetch(info.asset.url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败：HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  const out = fs.createWriteStream(temp);
  let done = 0;
  let lastEmit = 0;
  let writeError: Error | null = null;
  out.on("error", (err) => (writeError = err));

  try {
    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    for await (const chunk of source) {
      if (writeError) throw writeError;
      out.write(chunk as Buffer);
      done += (chunk as Buffer).length;
      const now = Date.now();
      if (now - lastEmit > 300) {
        lastEmit = now;
        broadcast("update:progress", {
          done,
          total,
          percent: total > 0 ? Math.min(100, Math.round((done * 100) / total)) : -1,
        } satisfies ProgressPayload);
      }
    }
    await new Promise<void>((resolve, reject) => out.end(() => (writeError ? reject(writeError) : resolve())));
  } catch (err) {
    out.destroy();
    fs.rmSync(temp, { force: true });
    throw err;
  }

  if (total > 0 && done !== total) {
    fs.rmSync(temp, { force: true });
    throw new Error(`下载不完整：期望 ${total} 字节，实际 ${done} 字节`);
  }
  fs.renameSync(temp, dest);
  return dest;
}

/** 运行新便携版并退出当前实例；zip 则打开所在文件夹让用户自行解压 */
function installUpdate(filePath: string): void {
  if (filePath.toLowerCase().endsWith(".exe")) {
    const child = spawn(filePath, [], { detached: true, stdio: "ignore", cwd: path.dirname(filePath) });
    child.unref();
    app.quit();
  } else {
    shell.showItemInFolder(filePath);
  }
}

/** 下载完成后的收尾：弹原生对话框决定立即运行 / 打开位置 / 稍后 */
async function promptInstall(win: BrowserWindow | null, filePath: string): Promise<void> {
  const options: Electron.MessageBoxOptions = {
    type: "info",
    title: "更新下载完成",
    message: `新版本 ${latestUpdate?.version ?? ""} 已下载完成`,
    detail: filePath,
    buttons: ["立即运行", "打开所在文件夹", "稍后"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };
  const { response } = win && !win.isDestroyed()
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (response === 0) installUpdate(filePath);
  else if (response === 1) shell.showItemInFolder(filePath);
}

/** 启动静默检查（仅打包版 + 开关开启时；离线静默失败，不打扰用户） */
export function startupUpdateCheck(): void {
  if (!app.isPackaged) return;
  if (!loadConfig().update.autoCheck) return;
  setTimeout(() => {
    checkForUpdate()
      .then((info) => {
        if (!info) return;
        latestUpdate = info;
        if (loadConfig().update.ignoredVersion === info.version) return;
        broadcast("update:available", info);
      })
      .catch((err) => console.log("[updater] 启动检查失败（静默）：", (err as Error).message));
  }, 5000);
}

export function registerUpdaterIpc(): void {
  // 手动检查（设置页）：返回检查结果；发现新版时记入 latestUpdate 供下载
  ipcMain.handle("update:check", async () => {
    try {
      const info = await checkForUpdate();
      latestUpdate = info;
      return {
        ok: true,
        available: info !== null,
        info,
        currentVersion: app.getVersion(),
      };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message, currentVersion: app.getVersion() };
    }
  });

  // 下载：进度经 update:progress 广播；完成后弹收尾对话框
  ipcMain.handle("update:download", async (event) => {
    if (downloadInFlight) return { ok: false as const, error: "已有下载在进行中" };
    if (!latestUpdate) return { ok: false as const, error: "请先检查更新" };
    downloadInFlight = true;
    try {
      const path2 = await downloadUpdate();
      downloadedPath = path2;
      broadcast("update:progress", { done: 1, total: 1, percent: 100 });
      const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindowSafe();
      void promptInstall(win, path2);
      return { ok: true, path: path2 };
    } catch (err) {
      broadcast("update:error", (err as Error).message);
      return { ok: false as const, error: (err as Error).message };
    } finally {
      downloadInFlight = false;
    }
  });

  ipcMain.handle("update:install", () => {
    if (downloadedPath && fs.existsSync(downloadedPath)) {
      installUpdate(downloadedPath);
      return { ok: true };
    }
    return { ok: false as const, error: "还没有已下载的新版本" };
  });

  ipcMain.handle("update:ignoreVersion", (_e, version: string) => {
    saveConfig({ update: { ...loadConfig().update, ignoredVersion: String(version ?? "") } });
    return { ok: true };
  });
}

function getMainWindowSafe(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows();
  return wins.find((w) => !w.isDestroyed()) ?? null;
}
