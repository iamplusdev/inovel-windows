import { safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./settings-store";

function getSessionPath(): string {
  return path.join(getDataDir(), "session.bin");
}

/**
 * decryptStringAsync 返回值归一化：Electron 45 起返回
 * { shouldReEncrypt: boolean, result: string } 包装对象，明文在 result 字段；
 * 旧版本直接返回 string。统一提取为纯文本。
 */
function normalizeDecrypted(decrypted: unknown): string {
  if (typeof decrypted === "string") return decrypted;
  if (decrypted && typeof decrypted === "object") {
    const wrapped = decrypted as { result?: unknown };
    if (typeof wrapped.result === "string") return wrapped.result;
    if (wrapped.result instanceof Uint8Array) {
      return Buffer.from(wrapped.result).toString("utf-8");
    }
  }
  if (decrypted instanceof Uint8Array) {
    return Buffer.from(decrypted).toString("utf-8");
  }
  throw new Error("safeStorage 解密结果类型异常");
}

/** 读取 safeStorage 加密的会话 Token；不可用或损坏时返回 null */
export async function loadToken(): Promise<string | null> {
  try {
    const raw = fs.readFileSync(getSessionPath());
    if (raw.length === 0) return null;
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
    return normalizeDecrypted(await safeStorage.decryptStringAsync(raw));
  } catch {
    return null;
  }
}

/** Token 使用 Windows DPAPI（safeStorage）加密后写入 session.bin，不落明文 */
export async function saveToken(token: string): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("系统加密存储（DPAPI）不可用，无法安全保存登录凭据");
  }
  fs.writeFileSync(getSessionPath(), await safeStorage.encryptStringAsync(token));
}

export function clearToken(): void {
  try {
    fs.rmSync(getSessionPath(), { force: true });
  } catch {
    // 忽略删除失败
  }
}

// —— 记住密码（safeStorage 加密，不落明文） ——

function getSecretPath(): string {
  return path.join(getDataDir(), "secret.bin");
}

export async function loadPassword(): Promise<string | null> {
  try {
    const raw = fs.readFileSync(getSecretPath());
    if (raw.length === 0) return null;
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
    return normalizeDecrypted(await safeStorage.decryptStringAsync(raw));
  } catch {
    return null;
  }
}

export async function savePassword(password: string): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("系统加密存储（DPAPI）不可用，无法安全保存密码");
  }
  fs.writeFileSync(getSecretPath(), await safeStorage.encryptStringAsync(password));
}

export function clearPassword(): void {
  try {
    fs.rmSync(getSecretPath(), { force: true });
  } catch {
    // 忽略删除失败
  }
}
