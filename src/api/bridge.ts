/**
 * window.api 的类型化封装；视图与 store 统一从这里调用，
 * 不直接触碰 window.api，便于将来 mock 与改动。
 */
import type { SettingsPatchShape } from "@/types/global";

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

function unwrap<T>(result: ApiResult<unknown>): T {
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
  async getBook<T = unknown>(bookId: number): Promise<T> {
    return unwrap<T>(await window.api.getBook(bookId));
  },
  async getToc<T = unknown>(bookId: number, page?: number, pageSize?: number): Promise<T> {
    return unwrap<T>(await window.api.getToc(bookId, page, pageSize));
  },
  async getChapter<T = unknown>(bookId: number, chapterId: number): Promise<T> {
    return unwrap<T>(await window.api.getChapter(bookId, chapterId));
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
    scanned?: number;
    updated?: number;
    errors?: number;
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
