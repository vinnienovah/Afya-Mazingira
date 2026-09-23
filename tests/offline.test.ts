import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PUBLIC = path.join(process.cwd(), "public");
const SW_SOURCE = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
const OFFLINE_HTML = fs.readFileSync(path.join(PUBLIC, "offline.html"), "utf8");

const ORIGIN = "https://afya-mazingira.test";

interface FetchEvent {
  request: { method: string; url: string; mode?: string; clone?: () => unknown };
  respondWith: (value: Promise<Response> | Response) => void;
}

type Listener = (event: never) => void;

/** A cache store with just the parts of the Cache API the worker uses. */
class FakeCache {
  entries = new Map<string, Response>();
  fetched: string[] = [];

  async add(request: string) {
    this.fetched.push(request);
    if (request.startsWith("/missing")) throw new Error(`404 ${request}`);
    this.entries.set(new URL(request, ORIGIN).href, new Response(`body of ${request}`, { status: 200 }));
  }

  async put(request: { url: string } | string, response: Response) {
    this.entries.set(typeof request === "string" ? new URL(request, ORIGIN).href : request.url, response);
  }

  async match(request: { url: string } | string, options?: { ignoreSearch?: boolean }) {
    const url = new URL(typeof request === "string" ? request : request.url, ORIGIN);
    for (const [key, response] of this.entries) {
      const candidate = new URL(key);
      if (candidate.href === url.href) return response;
      if (options?.ignoreSearch && candidate.pathname === url.pathname) return response;
    }
    return undefined;
  }
}

/**
 * Runs public/sw.js against fake globals and hands back its listeners, so the
 * worker's real branching is exercised without a browser or a network.
 */
function loadWorker(networkFetch: (request: unknown) => Promise<Response>) {
  const listeners = new Map<string, Listener>();
  const caches = new Map<string, FakeCache>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: {},
  };
  const cacheStorage = {
    open: async (name: string) => {
      const existing = caches.get(name) ?? new FakeCache();
      caches.set(name, existing);
      return existing;
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
    match: async (request: { url: string } | string, options?: { ignoreSearch?: boolean }) => {
      for (const cache of caches.values()) {
        const hit = await cache.match(request, options);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const run = new Function("self", "caches", "fetch", SW_SOURCE);
  run(self, cacheStorage, networkFetch);
  return { listeners, caches };
}

/** Installs the worker, then asks it for one request. */
async function respondTo(
  request: FetchEvent["request"],
  networkFetch: (request: unknown) => Promise<Response>,
  { install = true } = {},
) {
  const { listeners, caches } = loadWorker(networkFetch);
  if (install) {
    let installing: Promise<unknown> = Promise.resolve();
    (listeners.get("install") as unknown as (e: { waitUntil: (p: Promise<unknown>) => void }) => void)({
      waitUntil: (p) => { installing = p; },
    });
    await installing;
  }

  const answered = ask(listeners, request);
  return { response: answered ? await answered : null, caches };
}

/** The response the worker takes over the request with, or null if it passes. */
function ask(listeners: Map<string, Listener>, request: FetchEvent["request"]) {
  const captured: { value?: Promise<Response> | Response } = {};
  (listeners.get("fetch") as unknown as (e: FetchEvent) => void)({
    request,
    respondWith: (value) => { captured.value = value; },
  });
  return captured.value;
}

const offline = () => Promise.reject(new Error("network down"));
const navigation = { method: "GET", url: `${ORIGIN}/situation`, mode: "navigate" };

test("the worker precaches the offline document", async () => {
  const { caches } = await respondTo(navigation, offline);
  const shell = [...caches.values()].find((c) => c.fetched.includes("/offline.html"));
  assert.ok(shell, "the offline document is not in the precached shell");
  assert.ok(await shell.match("/offline.html"));
});

test("a page request that cannot reach the network is answered with the offline document", async () => {
  const { response } = await respondTo(navigation, offline);
  assert.ok(response, "navigations are not handled at all");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "body of /offline.html");
});

test("a page request still comes from the network when there is one", async () => {
  const live = async () => new Response("the real page", { status: 200 });
  const { response } = await respondTo(navigation, live);
  assert.equal(await response!.text(), "the real page");
});

test("an offline page request without the document cached fails cleanly rather than hanging", async () => {
  const { response } = await respondTo(navigation, offline, { install: false });
  assert.equal(response!.status, 503);
});

test("the situation still falls back to the last cached reading", async () => {
  const reading = `${ORIGIN}/api/situation`;
  const { listeners, caches } = loadWorker(offline);
  const store = new FakeCache();
  await store.put(reading, new Response(JSON.stringify({ current: { wbgt_c: 21.4 } }), { status: 200 }));
  caches.set("afya-data-v1", store);

  const response = await ask(listeners, { method: "GET", url: reading })!;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { current: { wbgt_c: 21.4 } });
});

test("the offline document reads the cache the worker writes the situation to", () => {
  const workerCache = SW_SOURCE.match(/const DATA_CACHE = "([^"]+)"/)?.[1];
  const pageCache = OFFLINE_HTML.match(/var DATA_CACHE = "([^"]+)"/)?.[1];
  assert.ok(workerCache);
  assert.equal(pageCache, workerCache);
});

test("the offline document says the reading is the last known one, in both languages", () => {
  // It ships its own text: none of the app's bundles are guaranteed to be
  // cached when it renders.
  assert.match(OFFLINE_HTML, /Last known reading/);
  assert.match(OFFLINE_HTML, /Usomaji wa mwisho unaojulikana/);
  assert.match(OFFLINE_HTML, /Recorded \{time\}/);
  assert.match(OFFLINE_HTML, /Ulirekodiwa \{time\}/);
});
