<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { bridge } from "@/api/bridge";
import { useSessionStore } from "@/stores/session";

const router = useRouter();
const session = useSessionStore();

const theme = ref<"paper" | "warm" | "night">("paper");
const alpha = ref(0.9);
const textAlpha = ref(1);
const fontSize = ref(19);
const lineHeight = ref(1.9);
const fontFamily = ref("");
const fontColor = ref("");
const systemFonts = ref<string[]>([]);
/** 列表是否来自真实系统枚举（区分内置兜底，兜底时点击下拉框会重试） */
const fontsFromSystem = ref(false);
const syncToServer = ref(true);
const syncToLegado = ref(true);
const dblClickHide = ref(true);
const skipTaskbar = ref(false);
const bossKey = ref("Ctrl+Alt+Q");
const closeAction = ref<"quit" | "minimize">("quit");
const version = ref("");
const saved = ref(false);

// —— 自动更新 ——
const autoCheck = ref(true);
const checking = ref(false);
const checkResult = ref(""); // 手动检查的结果文案
const updateAvailable = ref(false);
const updateVersion = ref("");
const updating = ref(false);
const updatePercent = ref(0);
const updateError = ref("");

const themeOptions: { value: "paper" | "warm" | "night"; label: string }[] = [
  { value: "paper", label: "纸白" },
  { value: "warm", label: "暖黄" },
  { value: "night", label: "夜间" },
];

/** type=color 不接受空值：空串（跟随主题）时展示默认色 */
const fontColorInput = computed({
  get: () => fontColor.value || "#282a2f",
  set: (v: string) => (fontColor.value = v),
});

const closeOptions: { value: "quit" | "minimize"; label: string }[] = [
  { value: "quit", label: "直接退出" },
  { value: "minimize", label: "最小化到托盘" },
];

onMounted(async () => {
  version.value = await window.api.app.version();
  const config = await bridge.getSettings();
  theme.value = config.reader.theme;
  alpha.value = config.reader.bgAlpha;
  textAlpha.value = config.reader.textAlpha ?? 1;
  fontSize.value = config.reader.fontSize;
  lineHeight.value = config.reader.lineHeight;
  fontFamily.value = config.reader.fontFamily || "";
  fontColor.value = config.reader.fontColor || "";
  syncToServer.value = config.sync.toServer;
  syncToLegado.value = config.sync.toLegado;
  dblClickHide.value = config.boss.doubleClickHide;
  skipTaskbar.value = config.boss.skipTaskbar;
  bossKey.value = config.boss.toggleShortcut.replace("Control", "Ctrl") || "";
  closeAction.value = config.window.closeAction ?? "quit";
  autoCheck.value = config.update.autoCheck ?? true;
  void loadFontList();
  // 下载进度事件（手动"检查更新→立即下载"也复用主进程广播）
  window.api.update.onProgress((p) => {
    updatePercent.value = p.percent >= 0 ? p.percent : 0;
  });
  window.api.update.onError((message) => {
    updateError.value = message;
    updating.value = false;
  });
});

/** 常见中文字体兜底列表（枚举不可用时） */
const FALLBACK_FONTS = [
  "Microsoft YaHei",
  "SimSun",
  "KaiTi",
  "SimHei",
  "FangSong",
  "DengXian",
  "等线",
  "宋体",
  "黑体",
  "楷体",
  "仿宋",
];

/** 字体列表：优先 Chromium Local Font Access，其次注册表 IPC，最后内置兜底。
 *  queryLocalFonts 需要用户手势（user activation），页面加载时的调用可能永远挂起，
 *  因此加超时；用户点击下拉框（focus）后手势可用，会重试枚举。 */
async function loadFontList(): Promise<void> {
  try {
    const nav = navigator as Navigator & { queryLocalFonts?: () => Promise<{ family: string }[]> };
    if (typeof nav.queryLocalFonts === "function") {
      const fonts = await Promise.race([
        nav.queryLocalFonts(),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2000)),
      ]);
      if (fonts) {
        const names = [...new Set(fonts.map((f) => f.family))].sort((a, b) =>
          a.localeCompare(b, "zh-Hans-CN"),
        );
        if (names.length > 0) {
          systemFonts.value = names;
          fontsFromSystem.value = true;
          return;
        }
      }
    }
  } catch {
    // 权限被拒或无用户激活，走降级
  }
  try {
    const regFonts = await window.api.listFonts();
    if (regFonts.length > 0) {
      systemFonts.value = regFonts;
      fontsFromSystem.value = true;
      return;
    }
  } catch {
    // 注册表不可读
  }
  systemFonts.value = FALLBACK_FONTS;
}

/** 下拉框获得焦点（用户手势）时，若真实系统字体尚未枚举成功则重试 */
function onFontSelectFocus(): void {
  if (!fontsFromSystem.value) void loadFontList();
}

async function save() {
  await bridge.setSettings({
    reader: {
      theme: theme.value,
      bgAlpha: alpha.value,
      textAlpha: textAlpha.value,
      fontSize: fontSize.value,
      lineHeight: lineHeight.value,
      fontFamily: fontFamily.value,
      fontColor: fontColor.value,
    },
    sync: {
      toServer: syncToServer.value,
      toLegado: syncToLegado.value,
    },
    boss: {
      doubleClickHide: dblClickHide.value,
      skipTaskbar: skipTaskbar.value,
      toggleShortcut: bossKey.value.trim(),
    },
    window: {
      closeAction: closeAction.value,
    },
    update: {
      autoCheck: autoCheck.value,
    },
  });
  saved.value = true;
  window.setTimeout(() => (saved.value = false), 1800);
}

async function logout() {
  await session.logout();
  void router.push({ name: "login" });
}

/** 手动检查更新（设置页按钮） */
async function checkUpdate(): Promise<void> {
  checking.value = true;
  checkResult.value = "";
  updateAvailable.value = false;
  updateError.value = "";
  const result = await window.api.update.check();
  checking.value = false;
  if (!result.ok) {
    checkResult.value = result.error ?? "检查失败";
    return;
  }
  if (result.available && result.info) {
    updateAvailable.value = true;
    updateVersion.value = result.info.version;
    checkResult.value = `发现新版本 v${result.info.version}（当前 v${result.currentVersion}）`;
  } else {
    checkResult.value = `已是最新版本（v${result.currentVersion}）`;
  }
}

/** 设置页内直接下载新版本；完成后主进程会弹原生对话框决定运行方式 */
async function startUpdateDownload(): Promise<void> {
  updating.value = true;
  updatePercent.value = 0;
  updateError.value = "";
  const result = await window.api.update.download();
  updating.value = false;
  if (!result.ok) updateError.value = result.error ?? "下载失败";
}

/** 在独立阅读窗口中打开阅读器骨架 */
function openReader(): void {
  void window.api.window.enterReader("demo");
}
</script>

<template>
  <div class="page settings-page">
    <header class="page-header settings-header">
      <h1 class="page-title">设置 <span class="version">v{{ version }}</span></h1>
    </header>

    <div class="settings-grid">
      <!-- 左列：账号 + 摸鱼 -->
      <div class="col">
        <section class="page-card">
          <h2 class="section-title">账号</h2>
          <div class="setting-row">
            <span class="setting-label">服务器</span>
            <span class="account-value" :title="session.serverUrl">
              {{ session.serverUrl || "未配置" }}
            </span>
          </div>
          <div class="setting-row">
            <span class="setting-label">用户名</span>
            <span class="account-actions">
              <span class="account-value">{{ session.username || "-" }}</span>
              <button type="button" class="ghost-btn sm" @click="logout">退出登录</button>
            </span>
          </div>
        </section>

        <section class="page-card">
          <h2 class="section-title">摸鱼</h2>
          <div class="setting-row">
            <span class="setting-label">双击阅读区隐藏窗口</span>
            <label class="switch">
              <input v-model="dblClickHide" type="checkbox" />
              <span>{{ dblClickHide ? "开" : "关" }}</span>
            </label>
          </div>
          <div class="setting-row">
            <span class="setting-label">隐藏任务栏图标</span>
            <label class="switch">
              <input v-model="skipTaskbar" type="checkbox" />
              <span>{{ skipTaskbar ? "开" : "关" }}</span>
            </label>
          </div>
          <div class="setting-row">
            <span class="setting-label">老板键</span>
            <input
              v-model="bossKey"
              class="field-input key-input"
              placeholder="Ctrl+Alt+Q"
              spellcheck="false"
            />
          </div>
        </section>
      </div>

      <!-- 右列：阅读模式 -->
      <div class="col">
        <section class="page-card">
          <h2 class="section-title">阅读模式</h2>
          <div class="setting-row">
            <span class="setting-label">主题</span>
            <div class="theme-options">
              <button
                v-for="item in themeOptions"
                :key="item.value"
                type="button"
                class="theme-btn"
                :class="{ 'is-active': theme === item.value }"
                @click="theme = item.value"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">字体</span>
            <select
              v-model="fontFamily"
              class="field-input font-select"
              @focus="onFontSelectFocus"
              @mousedown="onFontSelectFocus"
            >
              <option value="">默认（系统衬线）</option>
              <option v-for="name in systemFonts" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>
          <div class="setting-row">
            <span class="setting-label">字体颜色</span>
            <span class="color-wrap">
              <input v-model="fontColorInput" type="color" class="color-input" />
              <button
                type="button"
                class="ghost-btn sm"
                :disabled="!fontColor"
                @click="fontColor = ''"
              >
                跟随主题
              </button>
            </span>
          </div>
          <div class="setting-row">
            <span class="setting-label">背景透明度</span>
            <div class="range-wrap">
              <input v-model.number="alpha" type="range" min="0" max="1" step="0.05" />
              <span class="range-value">{{ Math.round(alpha * 100) }}%</span>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">字体透明度</span>
            <div class="range-wrap">
              <input v-model.number="textAlpha" type="range" min="0.05" max="1" step="0.05" />
              <span class="range-value">{{ Math.round(textAlpha * 100) }}%</span>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">字号</span>
            <div class="range-wrap">
              <input v-model.number="fontSize" type="range" min="14" max="28" step="1" />
              <span class="range-value">{{ fontSize }}px</span>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">行距</span>
            <div class="range-wrap">
              <input v-model.number="lineHeight" type="range" min="1.4" max="2.4" step="0.1" />
              <span class="range-value">{{ lineHeight }}</span>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-label">同步进度到服务器</span>
            <label class="switch">
              <input v-model="syncToServer" type="checkbox" />
              <span>{{ syncToServer ? "开" : "关" }}</span>
            </label>
          </div>
          <div class="setting-row">
            <span class="setting-label">同步到 Legado WebDAV</span>
            <label class="switch">
              <input v-model="syncToLegado" type="checkbox" />
              <span>{{ syncToLegado ? "开" : "关" }}</span>
            </label>
          </div>
        </section>
      </div>

      <!-- 通栏：更新 -->
      <section class="page-card span-2">
        <h2 class="section-title">更新</h2>
        <div class="setting-row">
          <span class="setting-label">启动时自动检查新版本</span>
          <label class="switch">
            <input v-model="autoCheck" type="checkbox" />
            <span>{{ autoCheck ? "开" : "关" }}</span>
          </label>
        </div>
        <div class="setting-row">
          <span class="setting-label">手动检查更新</span>
          <button
            type="button"
            class="ghost-btn sm"
            :disabled="checking || updating"
            @click="checkUpdate"
          >
            {{ checking ? "检查中…" : "检查更新" }}
          </button>
        </div>
        <p v-if="checkResult" class="muted-xs hint" :class="{ 'is-accent': updateAvailable }">
          {{ checkResult }}
        </p>
        <template v-if="updating">
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${updatePercent}%` }"></div>
          </div>
          <p class="muted-xs hint">下载中 {{ updatePercent }}%（完成后会询问是否运行）</p>
        </template>
        <div v-else-if="updateAvailable" class="setting-row">
          <span class="setting-label">下载 v{{ updateVersion }}</span>
          <button type="button" class="ghost-btn sm" :disabled="checking" @click="startUpdateDownload">
            立即下载
          </button>
        </div>
        <p v-if="updateError" class="muted-xs hint update-error">{{ updateError }}</p>
      </section>

      <!-- 通栏：窗口行为 + 快捷键 -->
      <section class="page-card span-2">
        <h2 class="section-title">窗口</h2>
        <div class="setting-row">
          <span class="setting-label">点击关闭按钮时</span>
          <div class="theme-options">
            <button
              v-for="item in closeOptions"
              :key="item.value"
              type="button"
              class="theme-btn"
              :class="{ 'is-active': closeAction === item.value }"
              @click="closeAction = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
        <p class="muted-xs hint">
          「最小化到托盘」关闭后应用仍在运行，通过托盘图标或老板键找回；彻底退出请用托盘菜单。
        </p>
      </section>

      <section class="page-card span-2">
        <h2 class="section-title">阅读快捷键</h2>
        <div class="shortcut-grid">
          <span class="kbd">↑ / ↓</span><span class="muted-xs">上下滚动</span>
          <span class="kbd">空格</span><span class="muted-xs">翻一屏（Shift 反向）</span>
          <span class="kbd">← / →</span><span class="muted-xs">上一章 / 下一章</span>
          <span class="kbd">T</span><span class="muted-xs">目录抽屉</span>
          <span class="kbd">Ctrl + ± / 0</span><span class="muted-xs">调整 / 重置字号</span>
          <span class="kbd">Esc</span><span class="muted-xs">关闭阅读窗口</span>
          <span class="kbd">双击正文</span><span class="muted-xs">隐藏窗口（摸鱼）</span>
          <span class="kbd">按住拖动</span><span class="muted-xs">移动阅读窗口</span>
          <span class="kbd">右下角拖拽</span><span class="muted-xs">缩放窗口，双击恢复默认</span>
        </div>
      </section>
    </div>

    <div class="actions">
      <button type="button" class="primary-btn" @click="save">保存设置</button>
      <button type="button" class="ghost-btn" @click="openReader">打开阅读器</button>
      <span v-if="saved" class="saved muted-xs">已保存</span>
    </div>
  </div>
</template>

<style scoped>
/* 紧凑设置页：两列网格，一屏放得下，无滚动 */
.settings-page {
  padding: 18px 28px 20px;
  gap: 12px;
}

.settings-header {
  min-height: 32px;
}

.version {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-3);
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: stretch;
}

.settings-grid .col {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-grid .col > .page-card {
  flex: 1;
}

.settings-grid .page-card {
  padding: 14px 16px;
}

.span-2 {
  grid-column: 1 / -1;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 32px;
  border-bottom: 1px solid var(--color-border);
  padding: 2px 0;
}

.setting-row:last-of-type {
  border-bottom: none;
}

.setting-label {
  flex: 1;
  color: var(--color-text-2);
  font-size: 13px;
}

.hint {
  margin: 8px 0 0;
}

.hint.is-accent {
  color: var(--color-accent);
}

.update-error {
  color: #d54941;
}

.progress-track {
  height: 6px;
  margin: 8px 0 2px;
  border-radius: 3px;
  background: var(--color-surface-2);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--color-accent);
  transition: width 0.3s ease;
}

.theme-options {
  display: flex;
  gap: 6px;
}

.theme-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-2);
  cursor: pointer;
  font-size: 12px;
}

.theme-btn.is-active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.range-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.range-wrap input[type="range"] {
  width: 150px;
  accent-color: var(--color-accent);
}

.range-value {
  width: 48px;
  text-align: right;
  color: var(--color-text-3);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}

.saved {
  color: #1f9d63;
}

.account-value {
  color: var(--color-text);
  font-size: 13px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ghost-btn.sm {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}

.switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-3);
  cursor: pointer;
}

.switch input {
  accent-color: var(--color-accent);
}

.key-input {
  width: 150px;
  height: 28px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
}

.font-select {
  width: 220px;
  height: 28px;
  padding: 0 6px;
  font-size: 12px;
}

.color-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-input {
  width: 42px;
  height: 28px;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  cursor: pointer;
}

/* fontColor 为空（跟随主题）时给取色器一个展示底色 */
.color-input:invalid,
.color-input[value=""] {
  color: #282a2f;
}

.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(3, auto 1fr);
  gap: 8px 14px;
  align-items: center;
}

.kbd {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-2);
  white-space: nowrap;
  justify-self: start;
}
</style>
