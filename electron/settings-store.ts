import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface ReaderSettings {
  /** 正文字体族名；空串=跟随系统默认衬线字体 */
  fontFamily: string;
  /** 正文字体颜色（CSS color）；空串=跟随主题默认 */
  fontColor: string;
  fontSize: number;
  lineHeight: number;
  theme: "paper" | "warm" | "night";
  /** 正文背景不透明度 0–1，只作用于正文背景层 */
  bgAlpha: number;
  /** 正文字体不透明度 0–1，只作用于文字颜色 */
  textAlpha: number;
  showProgressBar: boolean;
}

export interface SyncSettings {
  toServer: boolean;
  toLegado: boolean;
}

/** 摸鱼设置：快速隐藏/找回窗口 */
export interface BossSettings {
  /** 阅读区双击隐藏窗口 */
  doubleClickHide: boolean;
  /** 平时也隐藏任务栏图标（通过托盘/老板键找回） */
  skipTaskbar: boolean;
  /** 全局老板键（Electron accelerator），空字符串表示不启用 */
  toggleShortcut: string;
}

export interface WindowSettings {
  width: number;
  height: number;
  maximized: boolean;
  /** 点窗口关闭按钮的行为：quit=直接退出；minimize=隐藏到任务栏/托盘继续运行 */
  closeAction: "quit" | "minimize";
}

/** 阅读模式专属窗口尺寸，与主界面窗口互不影响 */
export interface ReaderWindowSettings {
  width: number;
  height: number;
}

export interface AppConfig {
  serverUrl: string;
  username: string;
  reader: ReaderSettings;
  sync: SyncSettings;
  boss: BossSettings;
  window: WindowSettings;
  readerWindow: ReaderWindowSettings;
}

const DEFAULT_CONFIG: AppConfig = {
  serverUrl: "",
  username: "",
  reader: {
    fontFamily: "",
    fontColor: "",
    fontSize: 19,
    lineHeight: 1.9,
    theme: "paper",
    bgAlpha: 0.9,
    textAlpha: 1,
    showProgressBar: false,
  },
  sync: { toServer: true, toLegado: true },
  boss: { doubleClickHide: true, skipTaskbar: false, toggleShortcut: "Control+Alt+Q" },
  window: { width: 1180, height: 780, maximized: false, closeAction: "quit" },
  readerWindow: { width: 480, height: 720 },
};

let cachedDataDir: string | null = null;

/** 便携版优先 exe 同目录 inovel-data，不可写时回退 %APPDATA%/inovel */
export function getDataDir(): string {
  if (cachedDataDir) return cachedDataDir;
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) {
    try {
      const dir = path.join(portableDir, "inovel-data");
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      cachedDataDir = dir;
      return dir;
    } catch {
      // 便携目录不可写，回退到 userData
    }
  }
  cachedDataDir = app.getPath("userData");
  fs.mkdirSync(cachedDataDir, { recursive: true });
  return cachedDataDir;
}

function getConfigPath(): string {
  return path.join(getDataDir(), "config.json");
}

export function loadConfig(): AppConfig {
  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
  const partial = (raw ?? {}) as Partial<AppConfig>;
  const merged: AppConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    ...partial,
    reader: { ...DEFAULT_CONFIG.reader, ...(partial.reader ?? {}) },
    sync: { ...DEFAULT_CONFIG.sync, ...(partial.sync ?? {}) },
    boss: { ...DEFAULT_CONFIG.boss, ...(partial.boss ?? {}) },
    window: { ...DEFAULT_CONFIG.window, ...(partial.window ?? {}) },
    readerWindow: { ...DEFAULT_CONFIG.readerWindow, ...(partial.readerWindow ?? {}) },
  };
  // 旧版 fontFamily 存的是枚举（"system"/"song"/"hei"），统一归一化为字体族名/空串
  if (merged.reader.fontFamily === "system") merged.reader.fontFamily = "";
  if (merged.reader.fontFamily === "song") merged.reader.fontFamily = "SimSun";
  if (merged.reader.fontFamily === "hei") merged.reader.fontFamily = "Microsoft YaHei";
  return merged;
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const merged: AppConfig = {
    ...current,
    ...patch,
    reader: { ...current.reader, ...(patch.reader ?? {}) },
    sync: { ...current.sync, ...(patch.sync ?? {}) },
    boss: { ...current.boss, ...(patch.boss ?? {}) },
    window: { ...current.window, ...(patch.window ?? {}) },
    readerWindow: { ...current.readerWindow, ...(patch.readerWindow ?? {}) },
  };
  fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

// —— 本地进度（progress/{bookId}.json） ——

export interface LocalProgress {
  bookId: number;
  chapterId: number | null;
  chapterIndex: number;
  /** 章内滚动比例，用于本机恢复 */
  scrollRatio: number;
  /** 章内字符偏移估算，用于 Legado 同步 */
  chapterPos: number;
  percent: number;
  updatedAt: string;
}

export function getProgressPath(bookId: number | string): string {
  const dir = path.join(getDataDir(), "progress");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${bookId}.json`);
}

export function loadProgress(bookId: number | string): LocalProgress | null {
  try {
    return JSON.parse(fs.readFileSync(getProgressPath(bookId), "utf-8")) as LocalProgress;
  } catch {
    return null;
  }
}

export function saveProgressLocal(data: LocalProgress): void {
  fs.writeFileSync(getProgressPath(data.bookId), JSON.stringify(data, null, 2), "utf-8");
}
