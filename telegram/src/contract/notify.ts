export type Level = "info" | "success" | "warning" | "error";

export interface Notification {
  level: Level;
  title?: string;
  body?: string;
  imagePath?: string;
  filePath?: string;
  caption?: string;
}

export const LEVEL_PREFIX: Record<Level, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "❌",
};
