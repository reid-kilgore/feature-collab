// How `tg status` and `tg doctor` say how healthy the dispatcher's listener is.

import type { DispatcherStatus } from "../daemon/protocol.ts";

export function formatAge(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

// One line, or nothing when the daemon did not send the figures (an older daemon).
export function dispatcherHealthLine(d: DispatcherStatus): string | undefined {
  if ((d.mode !== "on" && d.mode !== "disabled") || d.noListenerSeconds === undefined) return undefined;
  const listener = d.listening ? "a listener is attached" : `no listener for ${formatAge(d.noListenerSeconds)}`;
  const oldest = d.oldestUnconsumedSeconds == null ? "no unconsumed message" : `oldest unconsumed message ${formatAge(d.oldestUnconsumedSeconds)} old`;
  return `dispatcher listener: ${listener}; ${oldest}`;
}
