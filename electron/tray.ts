import { Menu, nativeImage, Tray } from "electron";
import path from "node:path";
import zlib from "node:zlib";
import { getIconPath, requestQuit, showMainWindow } from "./window";

let tray: Tray | null = null;

// —— 运行时生成 16x16 纯色 PNG 图标，避免依赖图标资源 ——

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function buildTrayIcon(size = 16): Electron.NativeImage {
  // 每行 = 1 filter byte + size*4 RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = y * stride + 1 + x * 4;
      // #4c6fff，四角留透明圆角效果
      const corner =
        (x === 0 || x === size - 1) && (y === 0 || y === size - 1);
      raw[p] = 0x4c;
      raw[p + 1] = 0x6f;
      raw[p + 2] = 0xff;
      raw[p + 3] = corner ? 0 : 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

export function ensureTray(): void {
  if (tray) return;
  // 优先使用应用图标 favicon.ico；加载失败时回退到运行时生成的纯色图标
  let icon = nativeImage.createFromPath(getIconPath());
  if (icon.isEmpty()) {
    console.warn("托盘图标加载失败，使用兜底图标");
    icon = buildTrayIcon();
  }
  tray = new Tray(icon);
  tray.setToolTip("iNovel");
  // 单击/双击托盘图标都恢复窗口（隐藏任务栏图标或摸鱼隐藏后的主要找回方式）
  tray.on("click", () => showMainWindow());
  tray.on("double-click", () => showMainWindow());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示窗口", click: () => showMainWindow() },
      { type: "separator" },
      { label: "退出 iNovel", click: () => requestQuit() },
    ]),
  );
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
