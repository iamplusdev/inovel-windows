/** 阅读参数：主题/字体/字号/行距/边距/透明度，改动持久化到本地配置 */
import { computed, ref } from "vue";
import { bridge } from "@/api/bridge";
import type { AppConfigShape } from "@/types/global";

export type ReaderTheme = "paper" | "warm" | "night";

const THEME_RGB: Record<ReaderTheme, string> = {
  paper: "247 245 240",
  warm: "243 231 211",
  night: "18 22 28",
};

/** 各主题默认文字色（自定义 fontColor 优先） */
const THEME_TEXT_COLOR: Record<ReaderTheme, string> = {
  paper: "#282a2f",
  warm: "#3b2f22",
  night: "#d6dbe5",
};

/** 常见中文字体兜底（系统枚举不可用时） */
const FALLBACK_FONTS = ["Microsoft YaHei", "SimSun", "KaiTi", "SimHei", "FangSong", "DengXian"];

/** #rrggbb → rgba(含透明度)；无法解析时原样返回 */
function withAlpha(hex: string, a: number): string {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function useReaderSettings(showToast: (message: string) => void) {
  const theme = ref<ReaderTheme>("paper");
  const themeOptions: { value: ReaderTheme; label: string }[] = [
    { value: "paper", label: "纸白" },
    { value: "warm", label: "暖黄" },
    { value: "night", label: "夜间" },
  ];
  const alpha = ref(0.9);
  /** 字体不透明度 0–1（只作用于文字颜色） */
  const textAlpha = ref(1);
  const fontSize = ref(19);
  const lineHeight = ref(1.9);
  /** 正文左右页边距（px） */
  const margin = ref(12);
  /** 正文字体族名（空串=系统默认衬线）与字体颜色（空串=主题默认） */
  const fontFamily = ref("");
  const fontColor = ref("");
  /** 阅读设置抽屉 */
  const settingsOpen = ref(false);
  const fonts = ref<string[]>([]);
  let fontsLoaded = false;

  /** 最终文字颜色 = 自定义颜色/主题默认色 + 字体透明度 */
  const textColor = computed(() => {
    const base = fontColor.value || THEME_TEXT_COLOR[theme.value] || THEME_TEXT_COLOR.paper;
    const a = Math.min(1, Math.max(0.05, textAlpha.value));
    return withAlpha(base, a);
  });

  const surfaceStyle = computed(() => ({
    "--reader-bg-rgb": THEME_RGB[theme.value] || THEME_RGB.paper,
    "--reader-bg-alpha": String(Math.min(1, Math.max(0, alpha.value))),
    fontSize: `${fontSize.value}px`,
    lineHeight: String(lineHeight.value),
    fontFamily: fontFamily.value
      ? `"${fontFamily.value}", "Microsoft YaHei", system-ui, sans-serif`
      : undefined,
    color: textColor.value,
    paddingLeft: `${margin.value}px`,
  }));

  const lowAlpha = computed(() => alpha.value < 0.3);

  /** 一行文字的实际像素高度（滚动按整行对齐） */
  function linePx(): number {
    return Math.max(1, fontSize.value * lineHeight.value);
  }

  async function loadFonts(): Promise<void> {
    if (fontsLoaded) return;
    fontsLoaded = true;
    try {
      const list = await window.api.listFonts();
      if (list.length > 0) {
        fonts.value = list;
        return;
      }
    } catch {
      // 注册表不可读，走兜底
    }
    fonts.value = FALLBACK_FONTS;
  }

  /** 把当前阅读参数整体写回配置（滑块拖动只改内存，松手/切换时调用） */
  function persistReader(): void {
    void bridge
      .setSettings({
        reader: {
          theme: theme.value,
          bgAlpha: alpha.value,
          textAlpha: textAlpha.value,
          fontSize: fontSize.value,
          lineHeight: lineHeight.value,
          margin: margin.value,
          fontFamily: fontFamily.value,
          fontColor: fontColor.value,
        },
      })
      .catch(() => showToast("阅读设置保存失败"));
  }

  function setTheme(next: ReaderTheme): void {
    if (theme.value === next) return;
    theme.value = next;
    persistReader();
  }

  function changeFontSize(delta: number): void {
    const next = Math.min(28, Math.max(14, fontSize.value + delta));
    if (next === fontSize.value) return;
    fontSize.value = next;
    void bridge.setSettings({ reader: { fontSize: next } });
    showToast(`字号 ${next}px`);
  }

  function resetFontSize(): void {
    fontSize.value = 19;
    void bridge.setSettings({ reader: { fontSize: 19 } });
    showToast("字号 19px");
  }

  /** 启动时把本机配置应用到内存参数 */
  function applyReaderConfig(reader: AppConfigShape["reader"]): void {
    theme.value = reader.theme;
    alpha.value = reader.bgAlpha;
    textAlpha.value = reader.textAlpha ?? 1;
    fontSize.value = reader.fontSize;
    lineHeight.value = reader.lineHeight;
    margin.value = reader.margin ?? 12;
    fontFamily.value = reader.fontFamily === "system" ? "" : reader.fontFamily || "";
    fontColor.value = reader.fontColor || "";
  }

  return {
    theme,
    themeOptions,
    alpha,
    fontSize,
    lineHeight,
    margin,
    fontFamily,
    settingsOpen,
    fonts,
    surfaceStyle,
    lowAlpha,
    linePx,
    loadFonts,
    persistReader,
    setTheme,
    changeFontSize,
    resetFontSize,
    applyReaderConfig,
  };
}
