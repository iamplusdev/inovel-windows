/** 服务端书籍/章节领域类型（novel-server 契约） */

export interface BookListItem {
  id: number;
  name: string;
  author: string;
  category: string;
  cover_url?: string;
  cover_thumb_url?: string;
  intro?: string;
  word_count?: number;
  chapter_count?: number;
  /** 阅读进度 0–100 */
  read_percent?: number;
  /** 最近阅读章节序号（0 基，-1/缺省=无记录） */
  read_chapter_index?: number;
  /** 最近阅读时间 ISO8601；空串=未读 */
  read_at?: string;
  status?: string;
  tags?: string[];
  /** 书架来源：both=双端共有 / server=仅服务端 / legado=仅手机在线 */
  origin?: "both" | "server" | "legado";
  /** 服务端是否有正文可阅读；仅 Legado 在线书为 false，id 为负数 */
  readable?: boolean;
  shelf_id?: number | null;
  source_name?: string;
  book_url?: string;
  source_url?: string;
  latest_chapter?: string;
  dur_chapter_title?: string;
  full_intro?: string;
}

export interface PagedResult<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

/** 书库筛选候选（分类/书源，按书籍数量降序） */
export interface BookFacets {
  categories: string[];
  sources: string[];
}

export interface BookDetail extends BookListItem {
  read_chapter_index: number;
}

export interface TocItem {
  id: number;
  index: number;
  name: string;
  title: string;
}

export interface TocResult extends PagedResult<TocItem> {
  book_id: number;
  book_name: string;
}
