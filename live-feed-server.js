const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const walletConfig = require('@hathor/wallet-lib/lib/config').default;
const nanoApi = require('@hathor/wallet-lib/lib/api/nano').default;
const NanoContractTransactionParser = require('@hathor/wallet-lib/lib/nano_contracts/parser').default;

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  });
}

loadEnvFile(process.env.ENV_FILE || path.join(process.cwd(), '.env'));

const PORT = Number(process.env.LIVE_FEED_PORT || 4546);
const LIVE_PATH = process.env.LIVE_FEED_PATH || '/live';
const PENDING_PATH = process.env.LIVE_FEED_PENDING_PATH || '/pending';
const SNAPSHOT_PATH = process.env.LIVE_FEED_SNAPSHOT_PATH || '/snapshot';
const HEALTH_PATH = process.env.LIVE_FEED_HEALTH_PATH || '/health';
const WS_URL = process.env.HATHOR_WS_URL || process.env.NEXT_PUBLIC_HATHOR_WS_URL || '';
const STATE_BACKEND = String(process.env.LIVE_FEED_STATE_BACKEND || 'auto').toLowerCase();
const INDEXER_MODE = String(process.env.LIVE_FEED_INDEXER_MODE || 'auto').toLowerCase();
const WALLET_TARGET = process.env.LIVE_FEED_WALLET_TARGET
  || process.env.NEXT_PUBLIC_WALLET_TARGET
  || process.env.WALLET_TARGET
  || '';
const WALLET_ID = process.env.LIVE_FEED_WALLET_ID
  || process.env.NEXT_PUBLIC_WALLET_ID
  || process.env.WALLET_ID
  || '';
const NODE_URL = process.env.LIVE_FEED_NODE_URL
  || process.env.NEXT_PUBLIC_HATHOR_NODE_URL
  || process.env.HATHOR_NODE_URL
  || 'http://localhost:8080/v1a';
const INDEXER_POLL_MS = Number(process.env.LIVE_FEED_INDEXER_POLL_MS || 15000);
const INDEXER_PAGE_SIZE = Number(process.env.LIVE_FEED_INDEXER_PAGE_SIZE || 1000);
const INDEXER_PAGE_CALLS = Number(process.env.LIVE_FEED_INDEXER_PAGE_CALLS || 4);
const INDEXER_HISTORY_PAGE_SIZE = Number(process.env.LIVE_FEED_INDEXER_HISTORY_PAGE_SIZE || 50);
const INDEXER_DISABLED = String(process.env.LIVE_FEED_INDEXER_DISABLED || '').toLowerCase() === 'true';
const FORCE_INDEXER = String(process.env.LIVE_FEED_FORCE_INDEXER || '').toLowerCase() === 'true';
const CHAIN_ID = process.env.LIVE_FEED_HATHOR_CHAIN
  || process.env.NEXT_PUBLIC_HATHOR_CHAIN
  || process.env.HATHOR_CHAIN
  || '';
const CONTRACT_ID = process.env.NEXT_PUBLIC_CANVAS_CONTRACT || '';
const ALLOW_ORIGIN = process.env.LIVE_FEED_ALLOW_ORIGIN || '*';
const SHARED_SECRET = process.env.LIVE_FEED_SHARED_SECRET
  || process.env.NEXT_PUBLIC_LIVE_FEED_SECRET
  || '';
const SHARED_SECRET_HEADER = String(process.env.LIVE_FEED_SHARED_SECRET_HEADER || 'x-live-feed-secret').toLowerCase();
const SHARED_SECRET_QUERY = process.env.LIVE_FEED_SHARED_SECRET_QUERY || 'secret';

const corsHeaders = {
  'access-control-allow-origin': ALLOW_ORIGIN,
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

const clients = new Set();
const pixels = new Map();
const pendingByTxId = new Map(); // Store pending paints by txId until confirmed
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL for pending
let paintCount = 0;
let lastUpdatedAt = 0;


function upsertPixel(x, y, color, { countPaint = false } = {}) {
  const key = `${x}:${y}`;
  pixels.set(key, color);
  if (countPaint) paintCount += 1;
  lastUpdatedAt = Date.now();
}

function recordPaint(x, y, color) {
  upsertPixel(x, y, color, { countPaint: true });
}

function snapshotPayload(format) {
  const entries = Array.from(pixels.entries());
  if (format === 'map') {
    const map = {};
    entries.forEach(([key, color]) => {
      map[key] = color;
    });
    return map;
  }
  return entries.map(([key, color]) => {
    const parts = key.split(':');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    return [x, y, color];
  });
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of clients) {
    try {
      sendEvent(res, event, data);
    } catch (err) {
      clients.delete(res);
    }
  }
}

function isAuthorized(req, reqUrl) {
  if (!SHARED_SECRET) return true;
  const headerValue = req.headers?.[SHARED_SECRET_HEADER];
  if (Array.isArray(headerValue)) {
    if (headerValue.includes(SHARED_SECRET)) return true;
  } else if (headerValue === SHARED_SECRET) {
    return true;
  }
  if (reqUrl) {
    const param = reqUrl.searchParams.get(SHARED_SECRET_QUERY);
    if (param === SHARED_SECRET) return true;
  }
  return false;
}

function emitPaintEvent({ x, y, color, status = 'confirmed', sender, txHash, contract }) {
  broadcast('paint', {
    x,
    y,
    color,
    status,
    sender: sender || null,
    txHash: txHash || null,
    contract: contract || null,
  });
}

function resolveStateBackend() {
  if (STATE_BACKEND === 'wallet') return WALLET_TARGET ? 'wallet' : null;
  if (STATE_BACKEND === 'node') return NODE_URL ? 'node' : null;
  if (WALLET_TARGET) return 'wallet';
  if (NODE_URL) return 'node';
  return null;
}

function buildStateUrl(backend) {
  const base = backend === 'wallet' ? WALLET_TARGET : NODE_URL;
  const trimmed = base.replace(/\/$/, '');
  return backend === 'wallet'
    ? `${trimmed}/wallet/nano-contracts/state`
    : `${trimmed}/nano_contract/state`;
}

function resolveNetworkName() {
  const raw = String(CHAIN_ID || '').trim();
  if (!raw) return 'testnet';
  if (raw.includes(':')) {
    const tail = raw.split(':').pop();
    if (tail) return tail;
  }
  return raw;
}

function normalizeNodeUrl() {
  const trimmed = String(NODE_URL || '').replace(/\/$/, '');
  return `${trimmed}/`;
}

const blueprintCache = new Map();
let parserReady = false;

function ensureParserReady() {
  if (parserReady) return;
  const networkName = resolveNetworkName();
  walletConfig.setServerUrl(normalizeNodeUrl());
  walletConfig.setNetwork(networkName);

  if (!nanoApi.__pxielBlueprintCache) {
    const original = nanoApi.getBlueprintInformation.bind(nanoApi);
    nanoApi.getBlueprintInformation = async (id) => {
      if (blueprintCache.has(id)) return blueprintCache.get(id);
      const info = await original(id);
      blueprintCache.set(id, info);
      return info;
    };
    nanoApi.__pxielBlueprintCache = true;
  }

  parserReady = true;
}

async function fetchState({ calls = [], fields = [] } = {}) {
  const backend = resolveStateBackend();
  if (!backend) throw new Error('No state backend configured.');
  if (!CONTRACT_ID) throw new Error('Missing contract id.');

  const url = new URL(buildStateUrl(backend));
  url.searchParams.set('id', CONTRACT_ID);
  calls.forEach((call) => url.searchParams.append('calls[]', call));
  fields.forEach((field) => url.searchParams.append('fields[]', field));

  const headers = backend === 'wallet' && WALLET_ID ? { 'X-Wallet-Id': WALLET_ID } : undefined;
  const res = await fetch(url.toString(), headers ? { headers } : undefined);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { }

  if (!res.ok) {
    const msg = json?.error || json?.message || text || `State request failed (${res.status})`;
    throw new Error(msg);
  }
  if (json && typeof json === 'object' && json.success === false) {
    const msg = json?.error || json?.message || 'State request failed.';
    throw new Error(msg);
  }
  const payload = (json && typeof json === 'object' && json.state && typeof json.state === 'object')
    ? json.state
    : json;
  if (payload && typeof payload === 'object' && payload.success === false) {
    const msg = payload?.error || payload?.message || 'State request failed.';
    throw new Error(msg);
  }
  return payload || {};
}

function unwrapValue(val) {
  let cur = val;
  for (let i = 0; i < 4; i += 1) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) break;
    if (Object.prototype.hasOwnProperty.call(cur, 'value')) {
      cur = cur.value;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(cur, 'result')) {
      cur = cur.result;
      continue;
    }
    break;
  }
  return cur;
}

function collectCalls(callsResult, requestedCalls = []) {
  const map = new Map();
  if (Array.isArray(callsResult)) {
    callsResult.forEach((item, idx) => {
      const key = item?.call || item?.method || item?.name || requestedCalls[idx] || '';
      if (!key) return;
      const val = item?.result ?? item?.value ?? item;
      map.set(key, val);
    });
    return map;
  }
  if (callsResult && typeof callsResult === 'object') {
    Object.entries(callsResult).forEach(([key, entry]) => {
      const val = entry?.result ?? entry?.value ?? entry;
      map.set(key, val);
    });
  }
  return map;
}

function extractCallValue(callsResult, prefix, requestedCalls = []) {
  const callMap = collectCalls(callsResult, requestedCalls);
  for (const [key, val] of callMap.entries()) {
    if (typeof key === 'string' && key.startsWith(prefix)) return val;
  }
  return null;
}

function extractFieldValue(fieldsResult, fieldName) {
  if (!fieldsResult) return undefined;
  if (Array.isArray(fieldsResult)) {
    const item = fieldsResult.find((entry) => {
      const key = entry?.name || entry?.field || entry?.key;
      return key === fieldName;
    });
    return item ? (item.result ?? item.value ?? item) : undefined;
  }
  if (fieldsResult && typeof fieldsResult === 'object') {
    const val = fieldsResult[fieldName];
    return val?.result ?? val?.value ?? val;
  }
  return undefined;
}

function coerceNumber(val) {
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num : null;
}

function parseCoords(rawKey) {
  let cur = unwrapValue(rawKey);
  for (let i = 0; i < 4; i += 1) {
    if (Array.isArray(cur) && cur.length >= 2) {
      const x = coerceNumber(cur[0]);
      const y = coerceNumber(cur[1]);
      if (x !== null && y !== null) return { x, y };
    }
    if (cur && typeof cur === 'object') {
      const x = coerceNumber(cur.x ?? cur[0]);
      const y = coerceNumber(cur.y ?? cur[1]);
      if (x !== null && y !== null) return { x, y };
      const next = cur.value ?? cur.result ?? cur.key ?? cur.k ?? cur.coord ?? cur.coords;
      if (next !== undefined && next !== cur) {
        cur = next;
        continue;
      }
    }
    break;
  }
  const str = String(cur ?? '');
  const match = str.match(/(-?\d+)[^\d-]+(-?\d+)/);
  if (!match) return null;
  const x = parseInt(match[1], 10);
  const y = parseInt(match[2], 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function upsertPixelIntoMap(target, x, y, color) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (typeof color !== 'string' || !color) return;
  target.set(`${x}:${y}`, color.toLowerCase());
}

function parsePixelsIntoMap(raw, target) {
  const unwrapped = unwrapValue(raw);
  if (!unwrapped) return;

  if (Array.isArray(unwrapped)) {
    unwrapped.forEach((item) => {
      if (!item) return;
      if (Array.isArray(item)) {
        if (item.length >= 3) {
          const x = coerceNumber(item[0]);
          const y = coerceNumber(item[1]);
          if (x !== null && y !== null) {
            upsertPixelIntoMap(target, x, y, unwrapValue(item[2]));
            return;
          }
        }
        if (item.length >= 2) {
          const coords = parseCoords(item[0]);
          if (coords) upsertPixelIntoMap(target, coords.x, coords.y, unwrapValue(item[1]));
        }
        return;
      }
      if (typeof item === 'object') {
        if ('x' in item && 'y' in item) {
          upsertPixelIntoMap(target, coerceNumber(item.x), coerceNumber(item.y), item.color ?? item.value ?? item.v);
          return;
        }
        const coords = parseCoords(item.key ?? item.k ?? item.coord ?? item.coords);
        if (coords) upsertPixelIntoMap(target, coords.x, coords.y, item.color ?? item.value ?? item.v);
      }
    });
    return;
  }

  if (typeof unwrapped === 'object') {
    Object.entries(unwrapped).forEach(([key, value]) => {
      const coords = parseCoords(key);
      if (!coords) return;
      const color = unwrapValue(value);
      upsertPixelIntoMap(target, coords.x, coords.y, color);
    });
  }
}

async function fetchContractStats() {
  const calls = ['get_stats()', 'get_pixels_count()'];
  const state = await fetchState({ calls });
  const callsResult = state?.calls ?? state?.data?.calls ?? state?.result?.calls ?? {};

  const statsRaw = extractCallValue(callsResult, 'get_stats', calls);
  const countRaw = extractCallValue(callsResult, 'get_pixels_count', calls);

  const statsVal = unwrapValue(statsRaw);
  const countVal = unwrapValue(countRaw);

  let nextPaintCount = null;
  if (Array.isArray(statsVal) && statsVal.length >= 1) {
    nextPaintCount = coerceNumber(statsVal[0]);
  } else if (statsVal && typeof statsVal === 'object') {
    nextPaintCount = coerceNumber(statsVal.paint_count ?? statsVal.painted ?? statsVal.painted_pixels);
  }

  const nextUniqueCount = coerceNumber(countVal);

  return {
    paintCount: nextPaintCount,
    uniqueCount: nextUniqueCount,
  };
}

async function fetchPixelsSnapshot(uniqueCount) {
  let totalUnique = uniqueCount;
  let hadErrors = false;
  if (!Number.isFinite(totalUnique)) {
    try {
      const countState = await fetchState({ calls: ['get_pixels_count()'] });
      const countRaw = extractCallValue(countState?.calls ?? {}, 'get_pixels_count', ['get_pixels_count()']);
      totalUnique = coerceNumber(unwrapValue(countRaw));
    } catch { }
  }

  const nextPixels = new Map();

  if (Number.isFinite(totalUnique)) {
    let offset = 0;
    while (offset < totalUnique) {
      const calls = [];
      for (let i = 0; i < INDEXER_PAGE_CALLS; i += 1) {
        const pageOffset = offset + i * INDEXER_PAGE_SIZE;
        if (pageOffset >= totalUnique) break;
        calls.push(`get_pixels_page(${pageOffset},${INDEXER_PAGE_SIZE})`);
      }
      if (!calls.length) break;

      const pageState = await fetchState({ calls });
      const callMap = collectCalls(pageState?.calls ?? {}, calls);

      for (const callKey of calls) {
        const rawPage = callMap.get(callKey);
        if (rawPage && typeof rawPage === 'object' && Object.prototype.hasOwnProperty.call(rawPage, 'errmsg')) {
          return { pixels: new Map(), hadErrors: true };
        }
        if (rawPage !== undefined) parsePixelsIntoMap(rawPage, nextPixels);
      }

      offset += calls.length * INDEXER_PAGE_SIZE;
    }
    return { pixels: nextPixels, hadErrors };
  }

  const fieldState = await fetchState({ fields: ['pixels'] });
  const fieldsResult = fieldState?.fields ?? fieldState?.data?.fields ?? {};
  const rawPixels = extractFieldValue(fieldsResult, 'pixels');
  if (rawPixels && typeof rawPixels === 'object' && Object.prototype.hasOwnProperty.call(rawPixels, 'errmsg')) {
    return { pixels: new Map(), hadErrors: true };
  }
  parsePixelsIntoMap(rawPixels, nextPixels);
  return { pixels: nextPixels, hadErrors };
}

function applySnapshot(nextPixels, nextPaintCount, { broadcastDiffs = false } = {}) {
  const updates = [];
  if (broadcastDiffs) {
    for (const [key, color] of nextPixels.entries()) {
      if (pixels.get(key) !== color) {
        const coords = parseCoords(key);
        if (coords) updates.push({ x: coords.x, y: coords.y, color });
      }
    }
  }

  const prevSize = pixels.size;
  pixels.clear();
  nextPixels.forEach((color, key) => {
    pixels.set(key, color);
  });

  if (Number.isFinite(nextPaintCount)) paintCount = nextPaintCount;
  if (updates.length || prevSize !== pixels.size || Number.isFinite(nextPaintCount)) {
    lastUpdatedAt = Date.now();
  }

  updates.forEach((paint) => {
    emitPaintEvent({ ...paint, status: 'confirmed', contract: CONTRACT_ID });
  });
}

function buildHistoryUrl(after) {
  const trimmed = String(NODE_URL || '').replace(/\/$/, '');
  const url = new URL(`${trimmed}/nano_contract/history`);
  url.searchParams.set('id', CONTRACT_ID);
  url.searchParams.set('count', String(INDEXER_HISTORY_PAGE_SIZE));
  if (after) url.searchParams.set('after', after);
  return url;
}

async function fetchHistoryPage(after) {
  if (!CONTRACT_ID) throw new Error('Missing contract id.');
  const url = buildHistoryUrl(after);
  const res = await fetch(url.toString());
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { }
  if (!res.ok) {
    const msg = json?.error || json?.message || text || `History request failed (${res.status})`;
    throw new Error(msg);
  }
  if (json && typeof json === 'object' && json.success === false) {
    const msg = json?.error || json?.message || 'History request failed.';
    throw new Error(msg);
  }
  return json || {};
}

async function fetchHistoryUpdates() {
  const entries = [];
  let after = null;
  let reachedCursor = false;

  while (true) {
    const page = await fetchHistoryPage(after);
    const history = Array.isArray(page.history) ? page.history : [];
    if (!history.length) break;

    for (const entry of history) {
      if (historyCursor && entry.hash === historyCursor) {
        reachedCursor = true;
        break;
      }
      entries.push(entry);
    }

    if (historyCursor && reachedCursor) break;
    if (!page.has_more) break;
    const last = history[history.length - 1];
    if (!last?.hash) break;
    after = last.hash;
  }

  const fullRefresh = !historyCursor || (historyCursor && !reachedCursor);
  if (entries.length) historyCursor = entries[0]?.hash || historyCursor;
  return { entries, fullRefresh };
}

async function decodeHistoryArgs(entry) {
  if (!entry?.nc_args || !entry?.nc_method || !entry?.nc_blueprint_id || !entry?.nc_address) return null;
  ensureParserReady();
  const parser = new NanoContractTransactionParser(
    entry.nc_blueprint_id,
    entry.nc_method,
    entry.nc_address,
    resolveNetworkName(),
    entry.nc_args,
  );
  await parser.parseArguments();
  return parser.parsedArgs || [];
}

function applyHistoryPaint(x, y, color, meta, { broadcastDiffs = false } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !color) return;
  const key = `${x}:${y}`;
  const prev = pixels.get(key);
  upsertPixel(x, y, color, { countPaint: false });
  if (broadcastDiffs && prev !== color) {
    emitPaintEvent({
      x,
      y,
      color,
      status: 'confirmed',
      sender: meta.sender,
      txHash: meta.txHash,
      contract: CONTRACT_ID,
    });
  }
}

async function applyHistoryEntries(entries, { broadcastDiffs = false } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const ordered = [...entries].reverse();

  for (const entry of ordered) {
    if (!entry || entry.is_voided) continue;
    const method = entry.nc_method;
    if (method !== 'paint' && method !== 'paint_batch') continue;

    let args;
    try {
      args = await decodeHistoryArgs(entry);
    } catch (err) {
      console.warn('[live-feed] Failed to decode nc_args:', err?.message || err);
      continue;
    }
    if (!Array.isArray(args) || args.length === 0) continue;

    const meta = {
      sender: entry?.nc_context?.caller_id || entry?.nc_address || null,
      txHash: entry?.hash || entry?.tx_id || null,
    };

    if (method === 'paint') {
      const x = coerceNumber(args[0]?.value);
      const y = coerceNumber(args[1]?.value);
      const color = String(args[2]?.value || '').toLowerCase();
      applyHistoryPaint(x, y, color, meta, { broadcastDiffs });
      continue;
    }

    if (method === 'paint_batch') {
      const xs = Array.isArray(args[0]?.value) ? args[0].value : [];
      const ys = Array.isArray(args[1]?.value) ? args[1].value : [];
      const colors = Array.isArray(args[2]?.value) ? args[2].value : [];
      const count = Math.min(xs.length, ys.length, colors.length);
      for (let i = 0; i < count; i += 1) {
        const x = coerceNumber(xs[i]);
        const y = coerceNumber(ys[i]);
        const color = String(colors[i] || '').toLowerCase();
        applyHistoryPaint(x, y, color, meta, { broadcastDiffs });
      }
    }
  }
}

function decodeTxB64ToJson(txB64) {
  try {
    const hexStr = Buffer.from(txB64, 'base64').toString('utf8');
    const bytes = new Uint8Array(Math.floor(hexStr.length / 2));
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = parseInt(hexStr.substr(i * 2, 2), 16);
    }
    const jsonStr = Buffer.from(bytes).toString('utf8');
    return JSON.parse(jsonStr);
  } catch (err) {
    return null;
  }
}

function extractTxData(messageObj) {
  try {
    const result = messageObj?.result;
    if (!result) return { txHash: null, txB64: null };

    const evmap = result.events || {};
    const txHash = Array.isArray(evmap['tx.hash']) && evmap['tx.hash'].length > 0 ? evmap['tx.hash'][0] : null;

    const txB64 = result?.data?.value?.TxResult?.tx
      ?? result?.data?.value?.tx
      ?? null;

    return { txHash, txB64 };
  } catch {
    return { txHash: null, txB64: null };
  }
}

function shouldAcceptContract(contract) {
  if (!CONTRACT_ID) return true;
  if (!contract) return false;
  return contract === CONTRACT_ID;
}

function broadcastPaint(paint, meta) {
  const x = Number(paint.x);
  const y = Number(paint.y);
  const color = String(paint.color || '').toLowerCase();
  if (!Number.isFinite(x) || !Number.isFinite(y) || color.length === 0) return;
  recordPaint(x, y, color);
  emitPaintEvent({
    x,
    y,
    color,
    status: 'confirmed',
    sender: meta.sender || null,
    txHash: meta.txHash || null,
    contract: meta.contract || null,
  });
}

function handleTxPayload(payload, txHash) {
  if (!payload || !shouldAcceptContract(payload.contract)) return;
  const fn = payload.function;
  const kwargs = payload.kwargs || {};

  if (fn === 'paint') {
    broadcastPaint({ x: kwargs.x, y: kwargs.y, color: kwargs.color }, {
      sender: payload.sender,
      txHash,
      contract: payload.contract,
    });
  }

  if (fn === 'paint_batch') {
    const xs = Array.isArray(kwargs.xs) ? kwargs.xs : [];
    const ys = Array.isArray(kwargs.ys) ? kwargs.ys : [];
    const colors = Array.isArray(kwargs.colors) ? kwargs.colors : [];
    const count = Math.min(xs.length, ys.length, colors.length);
    for (let i = 0; i < count; i += 1) {
      broadcastPaint({ x: xs[i], y: ys[i], color: colors[i] }, {
        sender: payload.sender,
        txHash,
        contract: payload.contract,
      });
    }
  }
}

let ws;
let reconnectDelayMs = 1000;
let shuttingDown = false;
let indexerTimer = null;
let indexerInFlight = false;
let indexerReady = false;
let lastUniqueCount = null;
let historyCursor = null;
let historyIndexReady = false;

function sanitizeWsUrl(rawUrl) {
  if (!rawUrl) return '';
  const hashIndex = rawUrl.indexOf('#');
  if (hashIndex >= 0) {
    return rawUrl.slice(0, hashIndex);
  }
  return rawUrl;
}

function scheduleReconnect() {
  if (shuttingDown) return;
  setTimeout(() => {
    if (shuttingDown) return;
    reconnectDelayMs = Math.min(reconnectDelayMs * 1.5, 15000);
    connectWs();
  }, reconnectDelayMs);
}

function connectWs() {
  const wsUrl = sanitizeWsUrl(WS_URL);
  if (!wsUrl) {
    console.warn('[live-feed] No HATHOR WS URL configured; confirmed feed disabled.');
    return;
  }
  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    console.warn('[live-feed] WS create error:', err?.message || err);
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    reconnectDelayMs = 1000;
    try {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        id: 1,
        params: { query: "tm.event='Tx'" },
      }));
      console.log('[live-feed] Subscribed to Tx events');
    } catch (err) {
      console.warn('[live-feed] Subscribe failed:', err?.message || err);
    }
  });

  ws.on('message', (data) => {
    let obj;
    try {
      obj = JSON.parse(data.toString());
    } catch {
      return;
    }
    const { txHash, txB64 } = extractTxData(obj);
    if (!txB64) return;
    const txJson = decodeTxB64ToJson(txB64);
    if (!txJson) return;
    const payload = txJson?.payload || null;
    if (!payload) return;
    handleTxPayload(payload, txHash);
  });

  ws.on('close', () => {
    if (shuttingDown) return;
    console.warn('[live-feed] WS closed, reconnecting...');
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    if (shuttingDown) return;
    console.warn('[live-feed] WS error:', err?.message || err);
  });
}

function shouldRunIndexer() {
  if (INDEXER_DISABLED) return false;
  if (FORCE_INDEXER) return true;
  return !WS_URL;
}

async function indexerTick() {
  if (indexerInFlight) return;
  indexerInFlight = true;
  try {
    const stats = await fetchContractStats();
    const nextPaintCount = stats.paintCount;
    const nextUniqueCount = stats.uniqueCount;

    const paintChanged = Number.isFinite(nextPaintCount) && nextPaintCount !== paintCount;
    const uniqueChanged = Number.isFinite(nextUniqueCount) && nextUniqueCount !== lastUniqueCount;
    const shouldRefresh = !indexerReady || paintChanged || uniqueChanged;
    const historyShouldRefresh = !historyIndexReady || shouldRefresh;

    let usedStateSnapshot = false;

    if (INDEXER_MODE !== 'history' && shouldRefresh) {
      const { pixels: nextPixels, hadErrors } = await fetchPixelsSnapshot(nextUniqueCount);
      const hasPixels = nextPixels.size > 0;
      const canAccept = !hadErrors && (hasPixels || Number(nextUniqueCount) === 0 || nextUniqueCount == null);

      if (INDEXER_MODE === 'state' || canAccept) {
        applySnapshot(nextPixels, nextPaintCount, { broadcastDiffs: indexerReady });
        indexerReady = true;
        if (Number.isFinite(nextUniqueCount)) lastUniqueCount = nextUniqueCount;
        usedStateSnapshot = true;

        // Clean up pending entries that are now confirmed on-chain
        pendingByTxId.forEach((entry, txId) => {
          if (!Array.isArray(entry.paints)) {
            pendingByTxId.delete(txId);
            return;
          }
          // Check if ALL paints from this tx are now confirmed
          const allConfirmed = entry.paints.every(paint => {
            const key = `${paint.x}:${paint.y}`;
            const chainColor = pixels.get(key);
            return chainColor && chainColor === paint.color;
          });
          if (allConfirmed) {
            pendingByTxId.delete(txId);
          }
        });
      }
    }

    if (!usedStateSnapshot && INDEXER_MODE !== 'state' && historyShouldRefresh) {
      const { entries, fullRefresh } = await fetchHistoryUpdates();
      if (fullRefresh) {
        pixels.clear();
        historyIndexReady = false;
      }
      if (entries.length) {
        await applyHistoryEntries(entries, {
          broadcastDiffs: historyIndexReady && !fullRefresh,
        });
      }
      if (Number.isFinite(nextPaintCount)) paintCount = nextPaintCount;
      if (Number.isFinite(nextUniqueCount)) lastUniqueCount = nextUniqueCount;
      indexerReady = true;
      historyIndexReady = true;
    }
  } catch (err) {
    console.warn('[live-feed] Indexer error:', err?.message || err);
  } finally {
    indexerInFlight = false;
  }
}

function startIndexer() {
  if (!shouldRunIndexer()) return;
  if (!CONTRACT_ID) {
    console.warn('[live-feed] Indexer disabled (missing contract id).');
    return;
  }
  const backend = resolveStateBackend();
  if (INDEXER_MODE !== 'history' && !backend) {
    console.warn('[live-feed] Indexer disabled (no state backend).');
    return;
  }
  if ((INDEXER_MODE === 'history' || INDEXER_MODE === 'auto') && !NODE_URL) {
    console.warn('[live-feed] Indexer disabled (no node URL for history mode).');
    return;
  }
  const modeLabel = INDEXER_MODE === 'auto' ? 'auto' : INDEXER_MODE;
  const backendLabel = backend || 'history';
  console.log(`[live-feed] Indexer enabled (${modeLabel}/${backendLabel}${INDEXER_POLL_MS > 0 ? `, ${INDEXER_POLL_MS}ms poll` : ''}).`);
  indexerTick();
  if (INDEXER_POLL_MS > 0) {
    indexerTimer = setInterval(indexerTick, INDEXER_POLL_MS);
    indexerTimer.unref();
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith(HEALTH_PATH)) {
    res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith(SNAPSHOT_PATH)) {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const format = reqUrl.searchParams.get('format') || 'array';

    // Clean expired pending and build pending payload
    const now = Date.now();
    const pendingPayload = [];
    pendingByTxId.forEach((entry, txId) => {
      if (now - entry.timestamp > PENDING_TTL_MS) {
        pendingByTxId.delete(txId);
      } else {
        pendingPayload.push({
          txId,
          paints: entry.paints,
          sender: entry.sender,
          timestamp: entry.timestamp,
        });
      }
    });

    res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({
      ok: true,
      contract: CONTRACT_ID || null,
      paint_count: paintCount,
      unique_count: pixels.size,
      updated_at: lastUpdatedAt,
      pixels: snapshotPayload(format),
      pending: pendingPayload,
    }));
    return;
  }


  if (req.method === 'GET' && req.url?.startsWith(LIVE_PATH)) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...corsHeaders,
    });
    res.write('\n');
    clients.add(res);
    sendEvent(res, 'hello', { ok: true });
    req.on('close', () => {
      clients.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith(PENDING_PATH)) {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    if (!isAuthorized(req, reqUrl)) {
      res.writeHead(401, { 'content-type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 256 * 1024) {
        res.writeHead(413, { 'content-type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        return;
      }

      const paints = Array.isArray(payload.paints) ? payload.paints : [];
      if (!paints.length) {
        res.writeHead(400, { 'content-type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ ok: false, error: 'Missing paints' }));
        return;
      }

      const contract = payload.contract || CONTRACT_ID || null;
      if (!shouldAcceptContract(contract)) {
        res.writeHead(202, { 'content-type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ ok: true, ignored: true }));
        return;
      }

      const sender = payload.sender || null;
      const txHash = payload.txId || payload.txHash || null;

      // Store pending paints when txId is provided (wallet accepted)
      if (txHash) {
        const normalizedPaints = paints.map(p => ({
          x: Number(p.x),
          y: Number(p.y),
          color: String(p.color || '').toLowerCase(),
        })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.color);

        if (normalizedPaints.length > 0) {
          pendingByTxId.set(txHash, {
            paints: normalizedPaints,
            sender,
            contract,
            timestamp: Date.now(),
          });
        }
      }

      let sent = 0;
      paints.forEach((paint) => {
        const x = Number(paint.x);
        const y = Number(paint.y);
        const color = String(paint.color || '').toLowerCase();
        if (!Number.isFinite(x) || !Number.isFinite(y) || !color) return;
        broadcast('pending', {
          x,
          y,
          color,
          status: 'pending',
          sender,
          txHash,
          contract,
        });
        sent += 1;
      });

      res.writeHead(202, { 'content-type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ ok: true, sent }));
    });
    return;
  }


  res.writeHead(404, { 'content-type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

const heartbeatMs = Number(process.env.LIVE_FEED_HEARTBEAT_MS || 15000);
setInterval(() => {
  broadcast('ping', { t: Date.now() });
}, heartbeatMs).unref();

server.listen(PORT, () => {
  console.log(`[live-feed] SSE listening on http://localhost:${PORT}${LIVE_PATH}`);
  console.log(`[live-feed] Snapshot endpoint on http://localhost:${PORT}${SNAPSHOT_PATH}`);
  if (!WS_URL) {
    console.log('[live-feed] Confirmed feed disabled (no WS URL).');
  }
  if (CONTRACT_ID) {
    console.log(`[live-feed] Filtering contract: ${CONTRACT_ID}`);
  }
});

connectWs();
startIndexer();

function shutdown() {
  shuttingDown = true;
  try { ws && ws.close(); } catch { }
  try { indexerTimer && clearInterval(indexerTimer); } catch { }
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
