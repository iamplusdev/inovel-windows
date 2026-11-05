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
}

export interface PagedResult<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
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
