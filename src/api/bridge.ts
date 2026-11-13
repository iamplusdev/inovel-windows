/**
 * window.api 的类型化封装；视图与 store 统一从这里调用，
 * 不直接触碰 window.api，便于将来 mock 与改动。
 */
import type { SettingsPatchShape } from "@/types/global";

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  canceled?: boolean;
}

/** 旧请求被切章中止：调用方静默丢弃，不提示错误 */
export class RequestCanceledError extends Error {
  constructor() {
    super("请求已取消");
    this.name = "RequestCanceledError";
  }
}

/** 在线书换源候选（与 Web 端 /api/admin/online/books/:id/sources 一致） */
export interface BookSourceCandidate {
  source_id: number;
  source_name: string;
  book_url: string;
  toc_url: string;
  last_chapter: string;
  kind: string;
  word_count: number;
  current: boolean;
}

export interface BookSourcesResult {
  ok: boolean;
  book_id: number;
  current: { source_id: number; source_name: string };
  items: BookSourceCandidate[];
  total: number;
  failed?: number;
  hint?: string;
}

/** 章节正文结果；notModified=true 时 content 为空，复用本地缓存 */
export interface ChapterContent {
  content: string;
  etag: string;
  notModified: boolean;
}

export interface SwitchBookSourceResult {
  ok: boolean;
  book_id: number;
  source_id: number;
  source_name: string;
  total: number;
}

/** 手机书架在线书登记为服务端在线书的结果 */
export interface AdoptShelfBookResult {
  ok: boolean;
  book_id: number;
  created: boolean;
  title: string;
  source_name: string;
  readable: boolean;
}

/** 批量同步中被更新的一本书；服务端已完成「最新者胜」并写入 DB */
export interface ProgressUpdatedBook {
  book_id: number;
  chapter_id?: number | null;
  chapter_index?: number | null;
  remote_time?: number | null;
  read_percent?: number | null;
  read_at?: string | null;
}

function unwrap<T>(result: ApiResult<unknown>): T {
  if (result.canceled) throw new RequestCanceledError();
  if (!result.ok) throw new Error(result.error || "请求失败");
  return result.data as T;
}

export const bridge = {
  // 连接与登录
  async testConnection(serverUrl: string) {
    return window.api.testConnection(serverUrl);
  },
  async login(serverUrl: string, username: string, password: string, remember = false) {
    return window.api.login(serverUrl, username, password, remember);
  },
  async getSavedCredentials() {
    return window.api.getSavedCredentials();
  },
  async authMe(): Promise<unknown> {
    return unwrap(await window.api.authMe());
  },
  async logout(): Promise<void> {
    await window.api.logout();
  },

  // 书库与内容
  async getBooks<T = unknown>(params?: Record<string, string | number | boolean>): Promise<T> {
    return unwrap<T>(await window.api.getBooks(params));
  },
  /** 书库筛选候选（老服务端没有该接口，调用方按空列表降级） */
  async getBookFacets<T = unknown>(): Promise<T> {
    return unwrap<T>(await window.api.getBookFacets());
  },
  async getBook<T = unknown>(bookId: number): Promise<T> {
    return unwrap<T>(await window.api.getBook(bookId));
  },
  async getToc<T = unknown>(bookId: number, page?: number, pageSize?: number): Promise<T> {
    return unwrap<T>(await window.api.getToc(bookId, page, pageSize));
  },
  async getChapter(bookId: number, chapterId: number, etag?: string): Promise<ChapterContent> {
    return unwrap<ChapterContent>(await window.api.getChapter(bookId, chapterId, etag));
  },
  /** 后台预取正文，走独立请求通道，不打断当前阅读请求 */
  async prefetchChapter(bookId: number, chapterId: number): Promise<ChapterContent> {
    return unwrap<ChapterContent>(await window.api.prefetchChapter(bookId, chapterId));
  },
  async getBookSources(bookId: number): Promise<BookSourcesResult> {
    return unwrap<BookSourcesResult>(await window.api.getBookSources(bookId));
  },
  async switchBookSource(
    bookId: number,
    data: { source_id: number; book_url: string; toc_url?: string; word_count?: number },
  ): Promise<SwitchBookSourceResult> {
    return unwrap<SwitchBookSourceResult>(await window.api.switchBookSource(bookId, data));
  },
  /** 手机书架在线书 → 服务端在线书，之后可直接进阅读器 */
  async adoptShelfBook(shelfId: number): Promise<AdoptShelfBookResult> {
    return unwrap<AdoptShelfBookResult>(await window.api.adoptShelfBook(shelfId));
  },

  // 进度
  async saveProgress(
    bookId: number,
    data: { percent: number; chapter_index: number },
  ): Promise<unknown> {
    return unwrap(await window.api.saveProgress(bookId, data));
  },
  async saveLocalProgress(data: {
    bookId: number;
    chapterId: number | null;
    chapterIndex: number;
    scrollRatio: number;
    chapterPos: number;
    percent: number;
    updatedAt: string;
  }): Promise<void> {
    await window.api.saveLocalProgress(data);
  },
  async loadLocalProgress(bookId: number) {
    return window.api.loadLocalProgress(bookId);
  },

  // Legado 同步
  /** 书库打开时批量拉取 WebDAV 进度；只同步书库中已存在的书籍 */
  async pullAllLegadoProgress(): Promise<{
    enabled?: boolean;
    listed?: boolean;
    remote_files?: number;
    matched?: number;
    ignored?: number;
    ignored_sample?: string[];
    /** mtime 预筛跳过的文件数（远端没更新，服务端未发 GET） */
    skipped?: number;
    scanned?: number;
    updated?: number;
    errors?: number;
    /** 本次被更新的书及最终进度；老服务端不返回，客户端据此决定是否整页刷新 */
    books?: ProgressUpdatedBook[];
  }> {
    return unwrap(await window.api.pullAllLegadoProgress());
  },
  async pullLegadoProgress(bookId: number, data?: unknown): Promise<unknown> {
    return unwrap(await window.api.pullLegadoProgress(bookId, data));
  },
  async pushLegadoProgress(bookId: number, data?: unknown): Promise<unknown> {
    return unwrap(await window.api.pushLegadoProgress(bookId, data));
  },

  // 设置
  async getSettings() {
    return window.api.getSettings();
  },
  async setSettings(patch: SettingsPatchShape) {
    return window.api.setSettings(patch);
  },
};
