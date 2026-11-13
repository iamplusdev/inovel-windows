# iNovel Windows 阅读器设计方案

版本：v0.1  
目标目录：`D:\MyProjects\01_Active_Projects\inovel`  
关联服务：`novel-server`（FastAPI + Vue3）

## 1. 项目定位

iNovel 是一个 Windows 桌面阅读客户端，只负责：

- 连接用户自己的 `novel-server`
- 浏览书库、目录和章节
- 上下滚动阅读
- 同步阅读进度到 server
- 通过 server 已配置的 WebDAV，与 Legado（开源阅读）同步进度

不包含导入、刮削、体检、批量编辑、后台管理等功能。

## 2. 已确认决策

| 项目 | 决策 |
|------|------|
| 技术栈 | Electron + Vue 3 + Vite + TypeScript |
| 阅读方式 | 只做上下滚动，不做左右翻页 |
| Legado 同步 | 需要；通过 server 的 WebDAV 接口完成 |
| 阅读模式 | 只显示正文内容，不显示窗口栏 |
| 透明度 | 只控制正文背景透明度，不控制文字和整个窗口 |
| 打包 | 优先 Windows 便携版（portable） |

## 3. 技术栈

- **桌面壳**：Electron
- **前端**：Vue 3 + Vite + TypeScript
- **状态管理**：Pinia
- **路由**：Vue Router（hash 或 memory 模式，避免打包后路径问题）
- **打包**：electron-builder，首版输出 Windows x64 portable exe
- **安全存储**：Electron `safeStorage`（Windows 下使用 DPAPI）
- **HTTP**：主进程 Node `fetch`，统一携带 Bearer Token
- **样式**：复用 server 前端阅读器的排版思路，但不依赖其构建产物

选择 Electron 的原因：

- 可以复用现有 Vue 阅读器逻辑和样式。
- 不需要额外安装 Rust 工具链。
- 无边框窗口、透明背景、窗口控制和 IPC 支持成熟。
- 主进程可直接请求 server，避免浏览器跨域限制。

## 4. 功能范围

### 4.1 连接与登录

- 输入服务器地址，支持：
  - `http://192.168.1.100:7311`
  - `https://novel.example.com`
  - 省略协议时默认补 `http://`（仅限本机/局域网地址）
- 公网地址强制 HTTPS：非内网主机的 `http://` 会被拒绝，避免 Bearer Token 明文传输
- 支持连接测试：请求 `/health` 和 `/api/auth/status`
- 用户名 / 密码登录：`POST /api/auth/login`
- 登录成功保存 Token，过期或 401 时回到登录页
- 记住服务器地址和用户名，不保存明文密码
- 如果服务端尚未初始化账号，提示先在 Web 端完成初始化

### 4.2 书库

- 封面列表或简洁列表
- 搜索书名、作者
- 筛选：书架来源（全部 / 双端共有 / 仅服务端 / 仅手机在线）、分类、书源
- 排序：最近更新 / 书名 / 作者 / 字数 / 章节数 / 最近阅读
- “继续阅读”区域（有筛选条件时隐藏）
- 显示书名、作者、阅读进度
- 仅手机在线的书可转为服务端在线书并直接进阅读器
- 只读，不提供编辑、删除、导入、刮削、体检入口

### 4.3 书籍详情与目录

- 书名、作者、分类、简介、阅读进度
- 章节目录加载与筛选
- 当前阅读章节定位
- “继续阅读”按钮
- 章节列表支持大量章节（按 server 的 500 条/页分页拉取）

### 4.4 阅读器

- 上下滚动阅读
- 上一章 / 下一章
- 章末继续滚动进入下一章
- 目录抽屉
- 阅读进度显示
- 键盘快捷键：
  - `↑` / `↓`：滚动
  - `空格` / `Shift+空格`：向下 / 向上翻一屏
  - `←` / `→`：上一章 / 下一章
  - `T`：目录
  - `Esc`：退出沉浸阅读
  - `Ctrl` + `+` / `-`：调整字号
  - `Alt+F4`：关闭窗口
- 当前章预取下一章，减少翻章等待
- 阅读器内部缓存最近章节，不提供整本书离线下载

### 4.5 阅读排版

可在阅读窗内的设置抽屉（悬停顶栏 → 设置）即时调整，也可在应用设置页修改：

- 字体：系统字体列表（默认系统衬线）
- 字号、行距
- 页边距（正文左右留白）
- 主题：纸白 / 暖黄 / 夜间
- **正文背景透明度**
- 底部常驻细进度条显示全书百分比

## 5. 阅读模式与窗口行为

### 5.1 普通模式

书库、详情、设置页使用无边框窗口，但显示自定义标题栏：

- 书名/页面标题
- 最小化、最大化、关闭
- 可拖拽区域

### 5.2 阅读模式

进入阅读后：

- 隐藏自定义标题栏
- 隐藏工具栏、侧栏和状态栏
- 默认只显示正文内容
- 底部常驻 3px 全书进度条；右上角常驻退出按钮（悬停阅读区提亮）
- 悬停阅读区显示顶栏：设置 / 换源（在线书）/ 目录
- `Esc` 退出阅读模式并恢复标题栏
- `Alt+F4` 始终可关闭窗口

窗口拖动方式：

- 顶部保留 4px 透明拖拽区域
- 支持 `Ctrl + 鼠标拖动` 移动窗口
- 不显示可见窗口栏，不占用正文空间

首次进入阅读模式显示一次操作提示，之后不再打扰。

## 6. 正文背景透明度

透明度只作用于正文背景层：

```css
.reader-surface {
  background: rgba(var(--reader-bg-rgb), var(--reader-bg-alpha));
}
```

- 文字颜色保持不透明，不跟随透明度变化
- 滑杆范围 0–100%，默认 90%
- 透明度低于 30% 时自动给文字增加轻微阴影，保证可读性
- 窗口本身设为透明无边框：
  - `transparent: true`
  - `frame: false`
  - `backgroundColor: "#00000000"`
- 不调用 `BrowserWindow.setOpacity()` 修改整个窗口透明度
- 主题只改变 RGB 值，透明度作为独立设置保存

## 7. 服务端 API 使用

桌面端登录后统一在请求头携带：

```http
Authorization: Bearer <session-token>
```

### 7.1 连接与登录

| 用途 | 接口 |
|------|------|
| 连接测试 | `GET /health` |
| 账号状态 | `GET /api/auth/status` |
| 登录 | `POST /api/auth/login` |
| 校验会话 | `GET /api/auth/me` |

### 7.2 书库与内容

| 用途 | 接口 |
|------|------|
| 书库列表 | `GET /api/admin/books` |
| 筛选候选（分类 / 书源） | `GET /api/admin/books/facets` |
| 继续阅读 | `GET /api/admin/books?read=true&sort=read` |
| 书籍详情 | `GET /api/admin/books/{id}` |
| 章节目录 | `GET /api/books/{id}/chapters?page=&page_size=500` |
| 章节正文 | `GET /api/books/{id}/chapters/{chapter_id}` |
| 手机在线书转服务端在线书 | `POST /api/admin/shelf/books/{shelf_id}/adopt` |

列表可使用 `fields` 参数减少返回体积，例如：

```text
fields=id,name,author,category,cover_thumb_url,read_percent,read_at,word_count,chapter_count
```

### 7.3 进度写回

| 用途 | 接口 |
|------|------|
| 写服务器进度 | `PUT /api/admin/books/{id}/progress` |
| 拉取 Legado 进度 | `POST /api/admin/books/{id}/sync/pull` |
| 推送 Legado 进度 | `POST /api/admin/books/{id}/sync/push` |
| 手动推送 | `POST /api/admin/books/{id}/sync/push-now` |
| WebDAV 配置状态 | `GET /api/admin/settings/webdav` |

`PUT progress` 请求体：

```json
{
  "percent": 42,
  "chapter_index": 17
}
```

## 8. 进度同步设计

### 8.1 本地进度

每本书本地保存：

```json
{
  "bookId": 12,
  "chapterId": 345,
  "chapterIndex": 17,
  "scrollRatio": 0.42,
  "chapterPos": 1830,
  "percent": 42,
  "updatedAt": "2026-11-04T12:00:00"
}
```

- `scrollRatio`：章内滚动比例，用于本机恢复
- `chapterPos`：章内字符偏移估算，用于 Legado 同步
- `percent`：全书进度，服务端只接收整数百分比

### 8.2 打开书籍

1. 请求 `GET /api/admin/books/{id}` 获取服务端进度。
2. 查询 `GET /api/admin/settings/webdav`：
   - 未启用：直接使用服务端进度和本地章内位置。
   - 已启用：调用 `POST /api/admin/books/{id}/sync/pull`，最多等待约 2 秒。
3. 如果远端更新：
   - 使用返回的 `chapter_id` / `chapter_index`。
   - 有 `chapter_pos` 时按字符偏移定位段落。
4. 如果 pull 超时或失败：
   - 不阻塞阅读，使用服务端现有进度先打开。
   - 晚到结果不强制跳转，只提示“远端有新进度”。

### 8.3 阅读中保存

- 滚动时本地立即记录，节流写盘。
- 每 5 秒或切章时调用 `PUT /api/admin/books/{id}/progress`。
- 进度计算：
  ```text
  percent = (chapterIndex + scrollRatio) / totalChapters * 100
  ```
- 服务端只保存章节序号和百分比，章内精确位置由本地保存。

### 8.4 Legado WebDAV 推送

WebDAV 凭据只保存在服务端，桌面端不接触 WebDAV 密码。

在以下时机调用 `POST /api/admin/books/{id}/sync/push`：

- 切章后
- 停止滚动约 10 秒后
- 关闭窗口 / 切后台前

请求体：

```json
{
  "chapter_id": 345,
  "chapter_pos": 1830,
  "client_time": 1762300000000
}
```

服务端负责：

- 生成 Legado 的 `bookProgress/书名_作者.json`
- 按时间最新者优先，避免覆盖另一台设备更新的进度
- 写入失败不阻塞桌面阅读

关闭窗口时先写本地和服务端进度，再调用一次 `sync/push`；不做长时间阻塞等待。

### 8.5 同步开关

设置中提供：

- `同步进度到服务器`：默认开启
- `同步到 Legado WebDAV`：默认开启，但只有服务端已配置 WebDAV 时生效

如果服务端未配置 WebDAV，显示“服务端未启用 WebDAV”，不弹出错误。

## 9. 进程与安全架构

```text
Renderer (Vue)
  ↓ 白名单 IPC
Preload (contextBridge)
  ↓
Main Process
  ├── HTTP Client (Bearer Token)
  ├── Session Store (safeStorage)
  ├── Settings Store
  └── BrowserWindow
```

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- 渲染进程不直接访问文件系统、Token 或任意 URL
- 主进程 IPC 只暴露固定方法：
  - `login`
  - `logout`
  - `getBooks`
  - `getBook`
  - `getToc`
  - `getChapter`
  - `saveProgress`
  - `pullLegadoProgress`
  - `pushLegadoProgress`
  - `getSettings`
  - `setSettings`
  - `windowControl`
- 禁用新窗口和外部导航
- 只允许 http/https server 地址
- 默认严格校验证书；自签名 HTTPS 作为单独选项，并在设置页警告

## 10. 本地文件

默认数据目录：

- 便携版：优先使用 `PORTABLE_EXECUTABLE_DIR/inovel-data`
- 无法写入时回退 `%APPDATA%/inovel`

```text
inovel-data/
├── config.json          # 服务器地址、窗口、阅读设置
├── session.bin          # safeStorage 加密的会话 Token
├── progress/
│   ├── 12.json          # 每本书本地进度
│   └── ...
└── logs/
```

不在本地保存 WebDAV 密码；不保存明文账号密码。

## 11. 推荐目录结构

```text
inovel/
├── electron/
│   ├── main.ts              # BrowserWindow、生命周期
│   ├── preload.ts           # 白名单 IPC
│   ├── api-client.ts        # HTTP、Bearer、超时、重试
│   ├── session-store.ts     # safeStorage Token
│   ├── settings-store.ts    # 配置与本地进度
│   └── window.ts            # 无边框/透明/窗口控制
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── router.ts
│   ├── api/
│   │   └── bridge.ts        # window.api 类型封装
│   ├── stores/
│   │   ├── session.ts
│   │   ├── library.ts
│   │   └── reader.ts
│   ├── views/
│   │   ├── LoginView.vue
│   │   ├── LibraryView.vue
│   │   ├── BookDetailView.vue
│   │   ├── ReaderView.vue
│   │   └── SettingsView.vue
│   ├── components/
│   │   ├── TitleBar.vue
│   │   ├── BookCard.vue
│   │   ├── TocDrawer.vue
│   │   └── ReaderSurface.vue
│   └── styles/
├── build/
│   └── icon.ico
├── electron-builder.yml
├── package.json
├── vite.config.ts
└── README.md
```

## 12. 打包方案

首版只做 portable：

```yaml
win:
  target:
    - target: portable
      arch:
        - x64
```

- 产物：`iNovel-<version>-portable.exe`
- 免安装，双击运行
- 数据优先写到 exe 同目录 `inovel-data`
- 后续再增加 NSIS 安装版，不影响首版
- 不做自动更新和代码签名；Windows SmartScreen 可能提示未知发布者

## 13. 错误与边界

- 服务器地址错误：登录页提示，不进入书库
- 账号未初始化：提示先在 Web 端初始化
- Token 过期：统一回登录页，保留服务器地址
- 网络断开：显示重连提示，已加载的正文章节仍可滚动
- 章节不存在：提示并回退到最近有效章节
- 目录过大：分页拉取，阅读器内缓存
- Legado WebDAV 拉取超时：不阻塞打开阅读
- Legado 推送失败：记录本地待同步，下一次保存或关闭时重试
- 服务端未配置 WebDAV：桌面端只同步 server 进度

## 14. 不做范围

- 导入、刮削、体检、批量编辑
- 标签管理、书库管理
- 整本离线下载
- 左右翻页阅读
- 阅读书签、笔记、TXT/EPUB 导出
- 多账号切换
- 自动更新
- 首版代码签名

## 15. 实施阶段

1. **脚手架**：Electron + Vue3 + Vite + TypeScript + 无边框窗口
2. **连接登录**：服务器地址、登录、Token 加密保存、401 处理
3. **书库与目录**：列表、搜索、继续阅读、详情、章节分页
4. **阅读器**：滚动阅读、章节切换、进度计算、本地进度
5. **服务端同步**：写 server 进度、打开时 pull、阅读中/关闭时 push
6. **Legado 同步**：WebDAV 状态检测、pull 精确章节/章内位置、push
7. **阅读体验**：沉浸模式、正文背景透明度、字体/主题、快捷键
8. **打包**：portable exe、便携数据目录、烟雾测试

## 16. 验收标准

- 能用域名或 IP 登录 server
- 书库、详情、目录能正常加载
- 阅读器只上下滚动，正文可读
- 阅读模式隐藏窗口栏，只显示正文
- 正文背景透明度可调，文字不透明
- 重新打开书籍能恢复章节和章内位置
- server 进度能在另一台客户端/网页端看到
- 配置 WebDAV 后，Legado 能拉到最新章节和章内位置
- 退出应用前进度已写入 server
- 便携版在 Windows 10/11 x64 可直接运行
