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

/** 内网常用域名后缀：这些地址走明文 HTTP 不视为泄露（token 不出局域网） */
const LAN_SUFFIXES = [".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain"];

/** 判断主机是否属于本机/局域网/加密隧道，决定能否放行明文 HTTP */
function isLanHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.includes(":")) {
    // IPv6 字面量：::1 / ULA(fc00::/7) / 链路本地(fe80::/10)
    if (host === "::1") return true;
    const head = host.split(":")[0];
    return /^f[cd][0-9a-f]{0,2}$/.test(head) || /^fe[89ab][0-9a-f]?$/.test(head);
  }
  if (LAN_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // 单段主机名（无点）通常是局域网机器名，如 nas、mybook
  if (!host.includes(".")) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  return (
    a === 127 || // 回环
    a === 10 || // 10/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    (a === 169 && b === 254) || // 链路本地
    (a === 100 && b >= 64 && b <= 127) // CGNAT / Tailscale 等加密隧道
  );
}

/**
 * 省略协议时默认补 http://（仅限内网）；去掉末尾斜杠。
 * 公网地址强制 HTTPS：Bearer Token 走明文 HTTP 等于把登录凭据交给链路上的任何人。
 */
export function normalizeServerUrl(input: string): string {
  let url = (input ?? "").trim().replace(/\/+$/, "");
  if (!url) throw new ApiError(0, "请先填写服务器地址");
  if (/\s/.test(url)) throw new ApiError(0, "服务器地址格式不正确");

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
  if (hasScheme && !/^https?:\/\//i.test(url)) {
    throw new ApiError(0, "服务器地址只支持 http:// 或 https://");
  }

  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? url : `http://${url}`);
  } catch {
    throw new ApiError(0, "服务器地址格式不正确");
  }
  if (!parsed.hostname) throw new ApiError(0, "服务器地址格式不正确");

  if (!hasScheme) {
    if (!isLanHost(parsed.hostname)) {
      throw new ApiError(
        0,
        `非局域网服务器必须使用 HTTPS，请填写 https://${url}（明文 HTTP 会让登录 Token 在网络上裸奔）`,
      );
    }
    url = `http://${url}`;
  } else if (parsed.protocol === "http:" && !isLanHost(parsed.hostname)) {
    throw new ApiError(
      0,
      `非局域网服务器 ${parsed.hostname} 必须使用 HTTPS（明文 HTTP 会让登录 Token 在网络上裸奔）`,
    );
  }
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
  /** 额外请求头（如 If-None-Match） */
  headers?: Record<string, string>;
  /** 外部取消信号（切章时中止旧请求） */
  signal?: AbortSignal;
  /** 重试次数；GET 默认 2，其它方法默认 0 */
  retries?: number;
}

/** 外部取消（切章）与超时区分开，调用方据此静默丢弃 */
export class RequestCanceledError extends Error {
  constructor() {
    super("请求已取消");
    this.name = "RequestCanceledError";
  }
}

const RETRY_DELAYS = [300, 800];
/** 单次尝试超过该耗时视为慢失败，不再重试，避免成倍拉长等待 */
const RETRY_SLOW_MS = 5000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * 客户端超时预算：必须比服务端出站等待更长，否则服务端仍在正常工作时就被切断，
 * 会出现服务端已提交、客户端却报失败的错位。
 * 服务端参考：在线目录 TOC_TIMEOUT=10s/页、正文 CONTENT_TIMEOUT=12s/页、
 * WebDAV 单次操作 timeout 2–20s、换源搜索 5s × 6 并发、批量同步回退逐本拉取。
 */
const TIMEOUTS = {
  default: 15000,
  health: 6000,
  login: 10000,
  /** 在线书正文可能续页抓取，留足 12s/页 的余量 */
  chapter: 20000,
  /** 在线书首开目录会现场同步，多页 TOC 每页最多 10s */
  toc: 30000,
  /** 候选书源并发搜索：6 源 × 5s 超时 */
  sourceSearch: 20000,
  /** 换源先抓完新目录才提交，超时切断会造成"报失败但已换源" */
  sourceSwitch: 60000,
  /** 单本进度拉取：WebDAV 单次操作最长 20s */
  progressPull: 25000,
  /** 推送在服务端后台执行，响应立即返回 */
  progressPush: 8000,
  /** 批量同步最多 300 本，逐本拉取时耗时随书数增长 */
  progressPullAll: 60000,
} as const;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RequestCanceledError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RequestCanceledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface RawResponse {
  status: number;
  payload: unknown;
  etag: string | null;
}

/** 章节正文结果；notModified=true 表示 304，调用方应复用本地缓存 */
export interface ChapterContent {
  content: string;
  /** 服务端正文 ETag；老服务端未返回时为空串 */
  etag: string;
  notModified: boolean;
}

/**
 * 统一 HTTP 客户端：主进程 Node fetch，携带 Bearer Token。
 * 401 时清除本地会话并通知渲染进程回到登录页。
 */
export class ApiClient {
  /** 一次会话过期只通知一次：并发请求同时 401 不重复清 token/跳登录 */
  private unauthorizedNotified = false;

  constructor(private readonly onUnauthorized: () => void) {}

  private baseUrl(): string {
    const raw = loadConfig().serverUrl;
    if (!raw) throw new ApiError(0, "尚未配置服务器地址");
    return normalizeServerUrl(raw);
  }

  private async sendOnce(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<RawResponse> {
    const url = new URL(path, this.baseUrl());
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.auth !== false) {
      const token = await loadToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (options.signal?.aborted) throw new RequestCanceledError();

    const controller = new AbortController();
    let timedOut = false;
    let canceled = false;
    const onAbort = () => {
      canceled = true;
      controller.abort();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? TIMEOUTS.default);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
      } catch (err) {
        if (canceled) throw new RequestCanceledError();
        const aborted = timedOut || (err instanceof Error && err.name === "AbortError");
        throw new ApiError(
          0,
          aborted ? "请求超时，请检查网络或服务器地址" : `无法连接服务器：${(err as Error).message}`,
        );
      }

      // auth:false 的 401（如登录密码错误）属于业务失败，不按会话过期处理
      if (res.status === 401 && options.auth !== false) {
        if (!this.unauthorizedNotified) {
          this.unauthorizedNotified = true;
          clearToken();
          this.onUnauthorized();
        }
        throw new ApiError(401, "登录已过期，请重新登录");
      }

      let text: string;
      try {
        text = await res.text();
      } catch (err) {
        if (canceled) throw new RequestCanceledError();
        throw new ApiError(0, `读取响应失败：${(err as Error).message}`);
      }
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }

      return { status: res.status, payload, etag: res.headers.get("etag") };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  /** 幂等请求短退避重试：快速失败的网络错误与 502/503/504，慢失败不重试 */
  private async send(method: string, path: string, options: RequestOptions = {}): Promise<RawResponse> {
    const retries = options.retries ?? (method === "GET" ? RETRY_DELAYS.length : 0);
    for (let attempt = 0; ; attempt++) {
      const startedAt = Date.now();
      let response: RawResponse | null = null;
      let error: unknown = null;
      try {
        response = await this.sendOnce(method, path, options);
      } catch (err) {
        if (err instanceof RequestCanceledError) throw err;
        error = err;
      }

      if (response && !RETRYABLE_STATUS.has(response.status)) return response;
      const retryableError = error instanceof ApiError && error.status === 0;
      const slow = Date.now() - startedAt > RETRY_SLOW_MS;
      if (attempt >= retries || slow || (error !== null && !retryableError)) {
        if (response) return response;
        throw error;
      }
      await delay(RETRY_DELAYS[attempt], options.signal);
    }
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const res = await this.send(method, path, options);
    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(
        res.status,
        extractErrorMessage(res.payload) ?? `请求失败（HTTP ${res.status}）`,
      );
    }
    return res.payload as T;
  }

  // —— 连接与登录 ——

  health(): Promise<unknown> {
    return this.request("GET", "/health", { auth: false, timeoutMs: TIMEOUTS.health });
  }

  authStatus(): Promise<unknown> {
    return this.request("GET", "/api/auth/status", {
      auth: false,
      timeoutMs: TIMEOUTS.health,
    });
  }

  async login(username: string, password: string): Promise<void> {
    const data = await this.request<unknown>("POST", "/api/auth/login", {
      body: { username, password },
      auth: false,
      timeoutMs: TIMEOUTS.login,
    });
    const token = extractToken(data);
    if (!token) throw new ApiError(0, "登录响应中未找到会话 Token");
    await saveToken(token);
    this.unauthorizedNotified = false;
  }

  me(): Promise<unknown> {
    return this.request("GET", "/api/auth/me");
  }

  // —— 书库与内容 ——

  getBooks(query?: Query): Promise<unknown> {
    return this.request("GET", "/api/admin/books", { query });
  }

  /** 筛选候选：分类 / 书源 */
  getBookFacets(): Promise<unknown> {
    return this.request("GET", "/api/admin/books/facets");
  }

  getBook(bookId: number): Promise<unknown> {
    return this.request("GET", `/api/admin/books/${bookId}`);
  }

  getToc(bookId: number, page = 1, pageSize = 500): Promise<unknown> {
    return this.request("GET", `/api/books/${bookId}/chapters`, {
      query: { page, page_size: pageSize },
      timeoutMs: TIMEOUTS.toc,
    });
  }

  /** 带 If-None-Match 取正文；304 返回 notModified，由调用方复用缓存 */
  async getChapter(
    bookId: number,
    chapterId: number,
    etag?: string,
    signal?: AbortSignal,
  ): Promise<ChapterContent> {
    const res = await this.send("GET", `/api/books/${bookId}/chapters/${chapterId}`, {
      headers: etag ? { "If-None-Match": etag } : undefined,
      signal,
      timeoutMs: TIMEOUTS.chapter,
    });
    if (res.status === 304) {
      return { notModified: true, content: "", etag: res.etag ?? etag ?? "" };
    }
    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(
        res.status,
        extractErrorMessage(res.payload) ?? `请求失败（HTTP ${res.status}）`,
      );
    }
    const data = (res.payload ?? {}) as { content?: unknown };
    return {
      notModified: false,
      content: String(data.content ?? ""),
      etag: res.etag ?? "",
    };
  }

  // —— 在线书换源 ——

  getBookSources(bookId: number): Promise<unknown> {
    // 候选书源要并发搜索多个站点，放宽超时并给服务端留余量
    return this.request("POST", `/api/admin/online/books/${bookId}/sources`, {
      body: {},
      timeoutMs: TIMEOUTS.sourceSearch,
    });
  }

  switchBookSource(
    bookId: number,
    body: {
      source_id: number;
      book_url: string;
      toc_url?: string;
      word_count?: number;
    },
  ): Promise<unknown> {
    return this.request("POST", `/api/admin/online/books/${bookId}/switch-source`, {
      body,
      timeoutMs: TIMEOUTS.sourceSwitch,
    });
  }

  /** 手机书架在线书 → 服务端在线书（登记元数据，正文按需抓取） */
  adoptShelfBook(shelfId: number): Promise<unknown> {
    return this.request("POST", `/api/admin/shelf/books/${shelfId}/adopt`, {
      body: {},
      timeoutMs: TIMEOUTS.sourceSwitch,
    });
  }

  // —— 进度与 Legado 同步 ——

  saveProgress(bookId: number, body: { percent: number; chapter_index: number }): Promise<unknown> {
    return this.request("PUT", `/api/admin/books/${bookId}/progress`, { body });
  }

  pullLegado(bookId: number, body?: unknown): Promise<unknown> {
    return this.request("POST", `/api/admin/books/${bookId}/sync/pull`, {
      body: body ?? {},
      timeoutMs: TIMEOUTS.progressPull,
    });
  }

  /** 书库打开时批量拉取 WebDAV 进度（扫描远端进度文件并写回 DB） */
  pullAllLegado(): Promise<unknown> {
    return this.request("POST", "/api/admin/sync/pull-all", {
      body: {},
      timeoutMs: TIMEOUTS.progressPullAll,
    });
  }

  pushLegado(bookId: number, body?: unknown): Promise<unknown> {
    return this.request("POST", `/api/admin/books/${bookId}/sync/push`, {
      body: body ?? {},
      timeoutMs: TIMEOUTS.progressPush,
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
