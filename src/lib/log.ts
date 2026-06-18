import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

export async function writeLog(
  level: LogLevel,
  area: string,
  message: string,
  details?: unknown
) {
  const detailText = stringifyDetails(details);
  try {
    await invoke("write_log", { level, area, message, details: detailText });
  } catch {
    // Browser/dev fallback: keep recent logs locally and still print to console.
    try {
      const key = "wore.logs";
      const current = JSON.parse(localStorage.getItem(key) || "[]") as unknown[];
      current.push({ ts: new Date().toISOString(), level, area, message, details: detailText });
      localStorage.setItem(key, JSON.stringify(current.slice(-300)));
    } catch {}
  }

  const line = `[WoRe:${area}] ${message}`;
  if (level === "error") console.error(line, details);
  else if (level === "warn") console.warn(line, details);
  else console.info(line, details ?? "");
}

export function writeError(area: string, message: string, error: unknown, extra?: unknown) {
  return writeLog("error", area, message, {
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
    extra,
  });
}

export async function getLogPath(): Promise<string | null> {
  try {
    return await invoke<string>("get_log_path");
  } catch {
    return null;
  }
}

function stringifyDetails(details: unknown): string | undefined {
  if (details === undefined || details === null) return undefined;
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}
