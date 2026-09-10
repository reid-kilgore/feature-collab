// `tg setup`: token -> Keychain, getMe verify, discover chat/user via getUpdates, write
// config, install+load the launchd plist, send a hello message. Idempotent.

import { createInterface } from "node:readline/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setToken, getToken, writeConfig, apiBase, isTestMode, shortHostname } from "../config.ts";
import { TelegramApi } from "../transports/telegram/api.ts";
import { renderNotification } from "../transports/telegram/render.ts";

const DISCOVER_TIMEOUT_MS = 5 * 60 * 1000;
const DISCOVER_POLL_MS = 2000;

export interface SetupOptions {
  token?: string;
  chatId?: string;
  userId?: string;
}

export async function runSetup(opts: SetupOptions): Promise<void> {
  let token = opts.token ?? getToken();
  if (!token) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    token = (await rl.question("Telegram bot token (from @BotFather): ")).trim();
    rl.close();
  }
  if (!token) {
    console.error("A bot token is required.");
    process.exitCode = 1;
    return;
  }
  setToken(token);
  console.error("Token stored.");

  const api = new TelegramApi(token, apiBase());
  const me = await api.getMe();
  console.error(`Verified bot: @${me.username ?? me.id}`);

  let chatId = opts.chatId;
  let userId = opts.userId;
  if (!chatId || !userId) {
    console.error(`Send any message to @${me.username ?? "your bot"} now. Waiting up to 5 minutes...`);
    const discovered = await discoverChat(api);
    if (!discovered) {
      console.error("Timed out waiting for a message. Re-run `tg setup` after messaging the bot.");
      process.exitCode = 1;
      return;
    }
    chatId = chatId ?? discovered.chatId;
    userId = userId ?? discovered.userId;
    console.error(`Discovered chat ${chatId}, user ${userId}.`);
  }

  writeConfig({ chatId, userId, botUsername: me.username ?? String(me.id) });
  console.error(`Config written for host ${shortHostname()}.`);

  if (!isTestMode()) {
    installLaunchd();
  } else {
    console.error("Test mode: skipping launchd install.");
  }

  try {
    const text = renderNotification("success", shortHostname(), "agent-telegram set up", "Hello from your laptop.");
    await api.sendMessage(chatId, text, { html: true });
    console.error("Hello message sent.");
  } catch (error) {
    console.error(`Warning: could not send hello message: ${(error as Error).message}`);
  }
}

async function discoverChat(api: TelegramApi): Promise<{ chatId: string; userId: string } | undefined> {
  const deadline = Date.now() + DISCOVER_TIMEOUT_MS;
  let offset = 0;
  while (Date.now() < deadline) {
    const updates = (await api.getUpdates(offset, 0)) as Array<{
      update_id: number;
      message?: { chat: { id: number }; from?: { id: number } };
    }>;
    for (const update of updates) {
      offset = update.update_id + 1;
      if (update.message?.from) {
        return { chatId: String(update.message.chat.id), userId: String(update.message.from.id) };
      }
    }
    await sleep(DISCOVER_POLL_MS);
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installLaunchd(): void {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const templatePath = path.join(here, "..", "..", "launchd", "com.reid.agent-telegram.plist.template");
    const template = readFileSync(templatePath, "utf8");
    const tgPath = path.join(here, "..", "..", "bin", "tg.js");
    const rendered = template
      .replace(/__NODE_PATH__/g, process.execPath)
      .replace(/__TG_JS_PATH__/g, tgPath)
      .replace(/__HOME__/g, homedir());

    const agentsDir = path.join(homedir(), "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });
    const plistPath = path.join(agentsDir, "com.reid.agent-telegram.plist");
    writeFileSync(plistPath, rendered);

    try {
      execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
    } catch {
      // not previously loaded; ignore
    }
    execFileSync("launchctl", ["load", plistPath], { stdio: "ignore" });
    console.error(`launchd agent installed and loaded at ${plistPath}.`);
  } catch (error) {
    console.error(`Warning: could not install launchd agent: ${(error as Error).message}`);
  }
}
