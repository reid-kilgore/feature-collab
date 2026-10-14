// Keeps the chat menu button's text in step with the number of open question sets:
// "Questions" at 0, "Questions (3)" at 3. A call goes out only when the count differs from the
// one last shown, and a burst of changes becomes one call.

export interface MenuCountDeps {
  // How many sets are open now.
  getCount: () => number;
  // Sends the new text to Telegram.
  setText: (text: string) => Promise<void>;
  log: (line: string) => void;
  debounceMs?: number;
}

export function menuText(count: number): string {
  return count > 0 ? `Questions (${count})` : "Questions";
}

export interface MenuCountUpdater {
  // Call whenever a set may have been created, submitted, cancelled or expired.
  schedule(): void;
  // Sends the current count now (daemon start), whatever was shown before.
  syncNow(): Promise<void>;
  stop(): void;
}

export function createMenuCountUpdater(deps: MenuCountDeps): MenuCountUpdater {
  const debounceMs = deps.debounceMs ?? 750;
  let shown: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  let dirty = false;

  async function run(force: boolean): Promise<void> {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      do {
        dirty = false;
        // Counting reads the store and parses stored payloads, so it can throw too.
        try {
          const count = deps.getCount();
          if (!force && count === shown) continue;
          force = false;
          await deps.setText(menuText(count));
          shown = count;
        } catch (error) {
          // Not fatal. `shown` is unchanged, so the next change tries again.
          deps.log(`menu button update failed: ${(error as Error).message}`);
        }
      } while (dirty);
    } finally {
      running = false;
    }
  }

  return {
    schedule() {
      if (timer || stopped) return;
      timer = setTimeout(() => {
        timer = undefined;
        // run() catches its own errors; this is a second guard against an unhandled rejection.
        run(false).catch((error) => deps.log(`menu button update failed: ${(error as Error).message}`));
      }, debounceMs);
    },
    syncNow() {
      return run(true);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
