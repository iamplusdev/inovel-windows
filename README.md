# iNovel

Windows 桌面小说阅读器，连接自建 `novel-server`，只保留连接、书库、目录、阅读和进度同步能力。

详细设计见 [DESIGN.md](./DESIGN.md)。

## 当前状态

已完成工程骨架：

- Electron 主进程、无边框透明窗口、窗口控制 IPC
- Vue 3 + Vite + TypeScript + Vue Router + Pinia
- 登录页、书库页、详情页、阅读器骨架、设置页
- 沉浸阅读模式（阅读页隐藏标题栏）
- 正文背景透明度、主题、字号、行距本地设置
- Windows portable 打包配置

下一阶段接入：

- 主进程服务器登录与 Token 加密存储
- 书库、目录、章节 API
- server 进度同步
- Legado WebDAV pull/push

## 开发

```bash
npm install
npm run dev
```

`npm run dev` 会先编译 Electron 主进程，再启动 Vite 与 Electron。

## 构建与打包

```bash
npm run typecheck
npm run build
npm run package:portable
```

便携版输出到 `release/`，文件名类似 `iNovel-0.1.0-portable.exe`。

## 目录

```text
electron/        Electron 主进程、preload、窗口控制
src/             Vue 渲染层
  views/         登录、书库、详情、阅读器、设置
  components/    标题栏等通用组件
  stores/        Pinia 状态
  types/         window.api 类型
DESIGN.md        软件设计方案
electron-builder.yml
```

## 安全边界

- 渲染进程不开启 Node 集成
- 使用 `contextIsolation` 与 preload 白名单 IPC
- 后续 Token 只保存在主进程，通过 `safeStorage` 加密
- 外部链接交给系统浏览器，不在应用内导航
