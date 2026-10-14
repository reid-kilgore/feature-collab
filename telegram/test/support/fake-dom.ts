// A very small DOM, just enough to run src/miniapp/web/app.js in node:vm and drive it. It is not
// a browser: no layout, no focus rules beyond what the page asks for. It exists so the page's
// own logic (which screen shows, what is sent, which Telegram calls are made) has tests.

import vm from "node:vm";
import { readFileSync } from "node:fs";

type Listener = (event: FakeEvent) => void;

export interface FakeEvent {
  type: string;
  target: FakeNode;
  key?: string;
  clientX?: number;
  clientY?: number;
  defaultPrevented: boolean;
  preventDefault(): void;
}

export class FakeNode {
  nodeType = 1;
  tagName: string;
  children: Array<FakeNode | FakeText> = [];
  parentNode: FakeNode | null = null;
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  className = "";
  style: Record<string, string> = {};
  value = "";
  checked = false;
  disabled = false;
  doc: FakeDocument;

  constructor(tagName: string, doc: FakeDocument) {
    this.tagName = tagName.toUpperCase();
    this.doc = doc;
  }
  get type(): string | undefined {
    return this.attrs.type;
  }
  get firstChild(): FakeNode | FakeText | undefined {
    return this.children[0];
  }
  appendChild<T extends FakeNode | FakeText>(kid: T): T {
    if (kid instanceof FakeNode) kid.parentNode = this;
    this.children.push(kid);
    return kid;
  }
  removeChild(kid: FakeNode): void {
    this.children = this.children.filter((c) => c !== kid);
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = String(value);
  }
  getAttribute(name: string): string | null {
    return name in this.attrs ? this.attrs[name]! : null;
  }
  addEventListener(type: string, fn: Listener): void {
    (this.listeners[type] ??= []).push(fn);
  }
  set textContent(value: string) {
    this.children = [];
    if (value !== "") this.appendChild(new FakeText(value));
  }
  get textContent(): string {
    return this.children.map((c) => (c instanceof FakeText ? c.text : c.textContent)).join("");
  }
  querySelectorAll(selector: string): FakeNode[] {
    const m = /^input\[type=(\w+)\]$/.exec(selector);
    if (!m) throw new Error(`fake DOM: unsupported selector ${selector}`);
    return this.find((n) => n.tagName === "INPUT" && n.attrs.type === m[1]);
  }
  find(predicate: (n: FakeNode) => boolean): FakeNode[] {
    const out: FakeNode[] = [];
    for (const c of this.children) {
      if (c instanceof FakeNode) {
        if (predicate(c)) out.push(c);
        out.push(...c.find(predicate));
      }
    }
    return out;
  }
  select(): void {}
  focus(): void {
    this.doc.activeElement = this;
    this.doc.fire(this, "focusin");
  }
  blur(): void {
    if (this.doc.activeElement === this) {
      this.doc.activeElement = null;
      this.doc.fire(this, "focusout");
    }
  }
}

export class FakeText {
  nodeType = 3;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

export class FakeDocument {
  body = new FakeNode("body", this);
  activeElement: FakeNode | null = null;
  hidden = false;
  listeners: Record<string, Listener[]> = {};
  private app = new FakeNode("div", this);

  constructor() {
    this.app.attrs.id = "app";
    this.body.appendChild(this.app);
  }
  createElement(tag: string): FakeNode {
    return new FakeNode(tag, this);
  }
  createTextNode(text: string): FakeText {
    return new FakeText(text);
  }
  getElementById(id: string): FakeNode | null {
    if (id === "app") return this.app;
    return this.body.find((n) => n.attrs.id === id)[0] ?? null;
  }
  addEventListener(type: string, fn: Listener): void {
    (this.listeners[type] ??= []).push(fn);
  }
  get root(): FakeNode {
    return this.app;
  }
  // Runs the listeners of `target` and its ancestors, then the document's, like a bubbling event.
  fire(target: FakeNode, type: string, extra: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      type,
      target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...extra,
    };
    for (let n: FakeNode | null = target; n; n = n.parentNode) for (const fn of n.listeners[type] ?? []) fn(event);
    for (const fn of this.listeners[type] ?? []) fn(event);
    return event;
  }
}

export interface FakeTelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(v: string): boolean;
  onEvent(name: string, fn: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(fn: () => void): void };
  HapticFeedback: { notificationOccurred(kind: string): void; impactOccurred(kind: string): void };
}

export interface PageRig {
  doc: FakeDocument;
  calls: string[];
  fetches: Array<{ path: string; method: string; body?: string }>;
  backClick(): void;
  tgEvent(name: string): void;
  flush(): Promise<void>;
  texts(): string;
  buttons(label: string): FakeNode[];
}

export interface Route {
  status?: number;
  body: unknown;
}

// Loads app.js into a fresh sandbox. `routes` maps "METHOD path" (path after /api/) to a response,
// or a function returning one.
export function loadPage(opts: { nativeBack: boolean; routes: Record<string, Route | ((body?: string) => Route)> }): PageRig {
  const doc = new FakeDocument();
  const calls: string[] = [];
  const fetches: PageRig["fetches"] = [];
  let backHandler: (() => void) | undefined;
  const tgEvents: Record<string, Array<() => void>> = {};
  const tg: FakeTelegramWebApp = {
    initData: "fake",
    ready: () => calls.push("ready"),
    expand: () => calls.push("expand"),
    close: () => calls.push("close"),
    isVersionAtLeast: () => opts.nativeBack,
    onEvent: (name, fn) => void (tgEvents[name] ??= []).push(fn),
    BackButton: {
      show: () => calls.push("back.show"),
      hide: () => calls.push("back.hide"),
      onClick: (fn) => {
        calls.push("back.onClick");
        backHandler = fn;
      },
    },
    HapticFeedback: {
      notificationOccurred: (kind) => calls.push(`haptic.${kind}`),
      impactOccurred: (kind) => calls.push(`impact.${kind}`),
    },
  };
  const store = new Map<string, string>();
  const sandbox = {
    window: { Telegram: { WebApp: tg }, scrollY: 0, scrollTo() {} },
    document: doc,
    location: { pathname: "/secret/" },
    navigator: {},
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    fetch: async (url: string, init: { method?: string; body?: string } = {}) => {
      const path = url.replace(/^\/secret\/api\//, "");
      const method = init.method ?? "GET";
      fetches.push({ path, method, body: init.body });
      const route = opts.routes[`${method} ${path}`];
      if (!route) throw new Error(`fake fetch: no route for ${method} ${path}`);
      const r = typeof route === "function" ? route(init.body) : route;
      return { status: r.status ?? 200, json: async () => r.body };
    },
    setTimeout: (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      t.unref();
      return t;
    },
    clearTimeout,
    Date,
    JSON,
    Object,
    Array,
    String,
    Math,
    Error,
  };
  vm.runInNewContext(readFileSync(new URL("../../src/miniapp/web/app.js", import.meta.url), "utf8"), sandbox);
  return {
    doc,
    calls,
    fetches,
    backClick: () => backHandler?.(),
    tgEvent: (name) => tgEvents[name]?.forEach((fn) => fn()),
    flush: async () => {
      for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    },
    texts: () => doc.root.textContent,
    buttons: (label) => doc.root.find((n) => n.tagName === "BUTTON" && n.textContent === label),
  };
}
