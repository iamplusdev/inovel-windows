import { clearToken, loadToken, saveToken } from "./session-store";
import { loadConfig } from "./settings-store";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 省略协议时默认补 http://，去掉末尾斜杠；只允许 http/https */
export function normalizeServerUrl(input: string): string {
  let url = (input ?? "").trim().replace(/\/+$/, "");
  if (!url) throw new ApiError(0, "请先填写服务器地址");
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new ApiError(0, "服务器地址格式不正确");
  return url;
}

const TOKEN_KEYS = ["token", "access_token", "session_token", "session", "jwt"];

function extractToken(data: unknown, depth = 0): string | null {
  if (depth > 2 || !data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  for (const key of TOKEN_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return extractToken(obj.data, depth + 1);
}

function extractErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  for (const key of ["detail", "message", "error", "msg"]) {
    const value = obj[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  timeoutMs?: number;
  /** false 时不携带 Authorization */
  auth?: boolean;
}

/**
 * 统一 HTTP 客户端：主进程 Node fetch，携带 Bearer Token。
 * 401 时清除本地会话并通知渲染进程回到登录页。
 */
export class ApiClient {
  constructor(private readonly onUnauthorized: () => void) {}

  private baseUrl(): string {
    const raw = loadConfig().serverUrl;
    if (!raw) throw new ApiError(0, "尚未配置服务器地址");
    return normalizeServerUrl(raw);
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.baseUrl());
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.auth !== false) {
      const token = await loadToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new ApiError(
        0,
        aborted ? "请求超时，请检查网络或服务器地址" : `无法连接服务器：${(err as Error).message}`,
      );
    }
    clearTimeout(timer);

    if (res.status === 401) {
      clearToken();
      this.onUnauthorized();
      throw new ApiError(401, "登录已过期，请重新登录");
    }

    const text = await res.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!res.ok) {
      throw new ApiError(res.status, extractErrorMessage(payload) ?? `请求失败（HTTP ${res.status}）`);
    }
    return payload as T;
  }

  // —— 连接与登录 ——

  health(): Promise<unknown> {
    return this.request("GET", "/health", { auth: false, timeoutMs: 6000 });
  }

  authStatus(): Promise<unknown> {
    return this.request("GET", "/api/auth/status", { auth: false, timeoutMs: 6000 });
  }

  async login(username: string, password: string): Promise<void> {
    const data = await this.request<unknown>("POST", "/api/auth/login", {
      body: { username, password },
      auth: false,
      timeoutMs: 10000,
    });
    const token = extractToken(data);
    if (!token) throw new ApiError(0, "登录响应中未找到会话 Token");
    await saveToken(token);
  }

  me(): Promise<unknown> {
    return this.request("GET", "/api/auth/me");
  }

  // —— 书库与内容 ——

  getBooks(query?: Query): Promise<unknown> {
    return this.request("GET", "/api/admin/books", { query });
  }

  getBook(bookId: number): Promise<unknown> {
    return this.request("GET", `/api/admin/books/${bookId}`);
  }

  getToc(bookId: number, page = 1, pageSize = 500): Promise<unknown> {
    return this.request("GET", `/api/books/${bookId}/chapters`, {
      query: { page, page_size: pageSize },
    });
  }

  getChapter(bookId: number, chapterId: number): Promise<unknown> {
    return this.request("GET", `/api/books/${bookId}/chapters/${chapterId}`);
  }

  // —— 进度与 Legado 同步 ——

  saveProgress(bookId: number, body: { percent: number; chapter_index: number }): Promise<unknown> {
    return this.request("PUT", `/api/admin/books/${bookId}/progress`, { body });
  }

  pullLegado(bookId: number, body?: unknown): Promise<unknown> {
    return this.request("POST", `/api/admin/books/${bookId}/sync/pull`, {
      body: body ?? {},
      timeoutMs: 8000,
    });
  }

  /** 书库打开时批量拉取 WebDAV 进度（扫描远端进度文件并写回 DB） */
  pullAllLegado(): Promise<unknown> {
    return this.request("POST", "/api/admin/sync/pull-all", {
      body: {},
      timeoutMs: 30000,
    });
  }

  pushLegado(bookId: number, body?: unknown): Promise<unknown> {
    return this.request("POST", `/api/admin/books/${bookId}/sync/push`, {
      body: body ?? {},
      timeoutMs: 8000,
    });
  }

  webdavStatus(): Promise<unknown> {
    return this.request("GET", "/api/admin/settings/webdav");
  }
}

export interface ConnectionTestResult {
  online: boolean;
  /** 账号是否已初始化；无法判断时为 null */
  initialized: boolean | null;
  message: string;
}

/** 连接测试：GET /health + GET /api/auth/status，不依赖已保存的 Token */
export async function testConnection(serverUrlRaw: string): Promise<ConnectionTestResult> {
  let base: string;
  try {
    base = normalizeServerUrl(serverUrlRaw);
  } catch (err) {
    return { online: false, initialized: null, message: (err as Error).message };
  }

  const fetchJson = async (
    path: string,
    timeoutMs: number,
  ): Promise<{ status: number | null; data: unknown; networkError: boolean }> => {
    try {
      const res = await fetch(new URL(path, base), { signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: res.status, data, networkError: false };
    } catch {
      return { status: null, data: null, networkError: true };
    }
  };

  const health = await fetchJson("/health", 6000);
  if (health.networkError) {
    return { online: false, initialized: null, message: "无法连接服务器，请检查地址和网络" };
  }

  const status = await fetchJson("/api/auth/status", 6000);
  const statusObj = (status.data && typeof status.data === "object" ? status.data : {}) as Record<
    string,
    unknown
  >;
  let initialized: boolean | null = null;
  for (const key of ["initialized", "has_account", "hasAccount", "account_initialized"]) {
    if (typeof statusObj[key] === "boolean") {
      initialized = statusObj[key] as boolean;
      break;
    }
  }

  if (initialized === false) {
    return {
      online: true,
      initialized,
      message: "服务器已连接，但账号尚未初始化，请先在 Web 端完成初始化",
    };
  }
  return { online: true, initialized, message: "服务器连接成功" };
}
