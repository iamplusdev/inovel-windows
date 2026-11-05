export {};

export interface ReaderSettingsShape {
  fontFamily: string;
  fontColor: string;
  fontSize: number;
  lineHeight: number;
  theme: "paper" | "warm" | "night";
  bgAlpha: number;
  textAlpha: number;
  showProgressBar: boolean;
}

export interface AppConfigShape {
  serverUrl: string;
  username: string;
  reader: ReaderSettingsShape;
  sync: { toServer: boolean; toLegado: boolean };
  boss: { doubleClickHide: boolean; skipTaskbar: boolean; toggleShortcut: string };
  window: { width: number; height: number; maximized: boolean; closeAction: "quit" | "minimize" };
  readerWindow: { width: number; height: number };
  update: { autoCheck: boolean; ignoredVersion: string };
}

export interface SettingsPatchShape {
  serverUrl?: string;
  username?: string;
  reader?: Partial<ReaderSettingsShape>;
  sync?: Partial<{ toServer: boolean; toLegado: boolean }>;
  boss?: Partial<{ doubleClickHide: boolean; skipTaskbar: boolean; toggleShortcut: string }>;
  window?: Partial<{
    width: number;
    height: number;
    maximized: boolean;
    closeAction: "quit" | "minimize";
  }>;
  update?: Partial<{ autoCheck: boolean; ignoredVersion: string }>;
}

export interface LocalProgressShape {
  bookId: number;
  chapterId: number | null;
  chapterIndex: number;
  scrollRatio: number;
  chapterPos: number;
  percent: number;
  updatedAt: string;
}

export interface UpdateAssetShape {
  name: string;
  url: string;
  size: number;
}

export interface UpdateInfoShape {
  version: string;
  tag: string;
  notes: string;
  asset: UpdateAssetShape;
}

export interface UpdateProgressShape {
  done: number;
  total: number;
  percent: number;
}

export interface UpdateCheckResultShape {
  ok: boolean;
  available?: boolean;
  info?: UpdateInfoShape | null;
  currentVersion: string;
  error?: string;
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface LoginResult {
  ok: boolean;
  serverUrl?: string;
  username?: string;
  error?: string;
}

export interface ConnectionTestResultShape {
  online: boolean;
  initialized: boolean | null;
  message: string;
}

declare global {
  interface Window {
    api: {
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<boolean>;
        close: () => Promise<void>;
        onCaptionDblClick: (callback: () => void) => () => void;
        enterReader: (bookId?: string | number) => Promise<boolean>;
        exitReader: () => Promise<boolean>;
        readerResize: (width: number, height: number) => Promise<boolean>;
        readerReady: () => void;
      };
      app: {
        version: () => Promise<string>;
      };
      update: {
        check: () => Promise<UpdateCheckResultShape>;
        download: () => Promise<{ ok: boolean; path?: string; error?: string }>;
        install: () => Promise<{ ok: boolean; error?: string }>;
        ignoreVersion: (version: string) => Promise<{ ok: boolean }>;
        onAvailable: (callback: (info: UpdateInfoShape) => void) => () => void;
        onProgress: (callback: (p: UpdateProgressShape) => void) => () => void;
        onError: (callback: (message: string) => void) => () => void;
      };
      boss: {
        hide: () => Promise<{ ok: boolean }>;
      };
      login: (
        serverUrl: string,
        username: string,
        password: string,
        remember?: boolean,
      ) => Promise<LoginResult>;
      getSavedCredentials: () => Promise<{ username: string; password: string | null }>;
      logout: () => Promise<{ ok: boolean }>;
      authMe: () => Promise<ApiResult>;
      testConnection: (serverUrl: string) => Promise<ConnectionTestResultShape>;
      getBooks: (params?: Record<string, string | number | boolean>) => Promise<ApiResult>;
      getBook: (bookId: number) => Promise<ApiResult>;
      getToc: (bookId: number, page?: number, pageSize?: number) => Promise<ApiResult>;
      getChapter: (bookId: number, chapterId: number) => Promise<ApiResult>;
      saveProgress: (
        bookId: number,
        data: { percent: number; chapter_index: number },
      ) => Promise<ApiResult>;
      saveLocalProgress: (data: LocalProgressShape) => Promise<{ ok: boolean }>;
      loadLocalProgress: (bookId: number) => Promise<LocalProgressShape | null>;
      pullLegadoProgress: (bookId: number, data?: unknown) => Promise<ApiResult>;
      pushLegadoProgress: (bookId: number, data?: unknown) => Promise<ApiResult>;
      getSettings: () => Promise<AppConfigShape>;
      setSettings: (patch: SettingsPatchShape) => Promise<AppConfigShape>;
      listFonts: () => Promise<string[]>;
      onSessionExpired: (callback: () => void) => () => void;
      onLibraryRefresh: (callback: () => void) => () => void;
    };
  }
}
