#!/usr/bin/env node
// CFMS Client — dev-only IPC relay.
//
// The Rust backend only talks to its own webview; a regular browser has no
// `window.__TAURI_INTERNALS__` to call. This relay bridges the two by evaluating
// `invoke(...)` calls *inside* the running webview through the WebView2 CDP
// debugger, so a browser can drive the real backend with real data.
//
// Setup:
//   1. start the app — debug runs open the WebView2 CDP port automatically, via
//      the `[env]` entry in `.cargo/config.toml`:
//        pnpm tauri dev
//   2. node scripts/dev-ipc-bridge.mjs   (or: pnpm dev:bridge)
//   3. open http://localhost:1909/ in a browser — the preview bridge notices the
//      relay and forwards every command to the running app.
//
// Endpoints (all responses carry permissive CORS headers):
//   GET  /health        → { ok, target }   null-free liveness probe
//   POST /invoke        → { ok, value } | { ok: false, error }

import http from 'node:http';

const CDP_PORT = Number(process.env.CFMS_CDP_PORT ?? 9222);
const BRIDGE_PORT = Number(process.env.CFMS_BRIDGE_PORT ?? 1910);
const APP_URL_HINT = process.env.CFMS_APP_URL ?? 'localhost:1909';
const REQUEST_TIMEOUT_MS = Number(process.env.CFMS_BRIDGE_TIMEOUT_MS ?? 30_000);

function log(message) {
  console.log(`[cfms-ipc] ${message}`);
}

// ---------------------------------------------------------------------------
// CDP connection
// ---------------------------------------------------------------------------

let client = null;
let connecting = null;

/**
 * Candidate pages in preference order.
 *
 * WebView2 can expose more than one page target for the same app (the dev-tools
 * window opened from `/dev`, or a webview that outlived a previous run), so the
 * main window is preferred: app root first, then anything that is not the
 * dev-tools route. `CFMS_APP_URL` pins an exact substring when that is not
 * enough. Candidates are validated individually in `ensureClient`.  */
function rankTargets(targets) {
  const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  const matching = pages.filter((target) => target.url.includes(APP_URL_HINT));
  const candidates = matching.length > 0 ? matching : pages;

  const root = `http://${APP_URL_HINT}/`;
  return [
    ...candidates.filter((target) => target.url === root),
    ...candidates.filter((target) => target.url !== root && !target.url.includes('/dev/')),
    ...candidates.filter((target) => target.url.includes('/dev/')),
  ];
}

/** A target is usable only once Tauri's IPC globals have been injected. */
async function isUsable(connection) {
  try {
    const probe = await connection.send('Runtime.evaluate', {
      expression: 'typeof window.__TAURI_INTERNALS__?.invoke === "function"',
      returnByValue: true,
    });
    return probe?.result?.value === true;
  } catch {
    return false;
  }
}

function openCdp(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 1;

    const fail = (error) => {
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      client = null;
    };

    socket.addEventListener('open', () => {
      resolve({
        send(method, params) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => socket.close(),
      });
    });

    socket.addEventListener('error', () => reject(new Error(`CDP socket error on ${webSocketDebuggerUrl}`)));
    socket.addEventListener('close', () => fail(new Error('CDP socket closed')));

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      const entry = message.id === undefined ? undefined : pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message ?? 'CDP error'));
      else entry.resolve(message.result);
    });
  });
}

async function ensureClient() {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    let targets;
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      targets = await response.json();
    } catch (error) {
      throw new Error(
        `cannot reach the WebView2 debugger on :${CDP_PORT} — is "pnpm tauri dev" running? `
        + `Debug builds open that port via [env] in .cargo/config.toml; a release build never will. `
        + `(${error.message})`,
      );
    }

    const candidates = rankTargets(targets);
    if (candidates.length === 0) throw new Error(`no page target matching "${APP_URL_HINT}" on :${CDP_PORT}`);

    // The webview can exist before the app finishes booting, in which case its
    // IPC globals are not injected yet — try the remaining candidates instead of
    // settling for a page that cannot answer.
    let lastError = null;
    for (const target of candidates) {
      let connection;
      try {
        connection = await openCdp(target.webSocketDebuggerUrl);
        if (await isUsable(connection)) {
          client = connection;
          log(`attached to ${target.url}`);
          return client;
        }
        lastError = new Error(`${target.url} has no Tauri IPC globals (still loading?)`);
      } catch (error) {
        lastError = error;
      }
      connection?.close();
    }

    throw lastError ?? new Error('no usable app page found');
  })().finally(() => {
    connecting = null;
  });

  return connecting;
}

// ---------------------------------------------------------------------------
// Command forwarding
// ---------------------------------------------------------------------------

/**
 * Runs `invoke` inside the app's own webview and reports the outcome as data, so
 * a rejected command never surfaces as a CDP exception.
 */
function buildExpression(command, args) {
  return `(async () => {
  try {
    const value = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args ?? {})});
    return { ok: true, value: value === undefined ? null : value };
  } catch (error) {
    const message = error && (error.message || error.toString) ? (error.message || String(error)) : String(error);
    return { ok: false, error: String(message) };
  }
})()`;
}

async function forward(command, args) {
  const connection = await ensureClient();
  const evaluation = await connection.send('Runtime.evaluate', {
    expression: buildExpression(command, args),
    awaitPromise: true,
    returnByValue: true,
  });

  const outcome = evaluation?.result?.value;
  if (!outcome || typeof outcome !== 'object') {
    const detail = evaluation?.exceptionDetails?.exception?.description
      ?? evaluation?.exceptionDetails?.text
      ?? 'the app webview returned no serialisable result';
    throw new Error(detail);
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function respond(response, status, payload) {
  const body = payload === null ? '' : JSON.stringify(payload);
  response.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    respond(response, 204, null);
    return;
  }

  const path = (request.url ?? '').split('?')[0];

  if (path === '/health' && request.method === 'GET') {
    try {
      await ensureClient();
      respond(response, 200, { ok: true, target: `:${CDP_PORT}` });
    } catch (error) {
      respond(response, 503, { ok: false, error: error.message });
    }
    return;
  }

  if (path === '/invoke' && request.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      respond(response, 400, { ok: false, error: `invalid body: ${error.message}` });
      return;
    }

    const command = body?.cmd;
    if (typeof command !== 'string' || command.length === 0) {
      respond(response, 400, { ok: false, error: 'cmd must be a non-empty string' });
      return;
    }

    try {
      const outcome = await withTimeout(
        forward(command, body.args ?? {}),
        REQUEST_TIMEOUT_MS,
        `"${command}" timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
      respond(response, 200, outcome);
    } catch (error) {
      respond(response, 502, { ok: false, error: error.message });
    }
    return;
  }

  respond(response, 404, { ok: false, error: `no route for ${request.method} ${path}` });
});

server.listen(BRIDGE_PORT, '127.0.0.1', () => {
  log(`relay listening on http://127.0.0.1:${BRIDGE_PORT} (CDP :${CDP_PORT}, app url ~ "${APP_URL_HINT}")`);
  log('waiting for the app webview…');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    client?.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
