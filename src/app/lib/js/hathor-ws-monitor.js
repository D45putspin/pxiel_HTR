'use client';

// Lightweight Tx subscription client for Hathor-compatible websocket endpoints.
// - Subscribes to tm.event='Tx' style feeds exposed by Hathor full nodes or bridges
// - Decodes Hathor tx payload (base64 -> hex string -> bytes -> JSON)
// - Calls onPaint for contract `paint` events

function decodeTxB64ToJson(txB64) {
  try {
    const hexStr = (typeof atob === 'function') ? atob(txB64) : Buffer.from(txB64, 'base64').toString('utf8');
    const bytes = new Uint8Array(Math.floor(hexStr.length / 2));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hexStr.substr(i * 2, 2), 16);
    }
    const jsonStr = new TextDecoder().decode(bytes);
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn('TX decode failed', e);
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

function emitPaints({ data, statusFallback, contractName, onPaint }) {
  if (!data || !onPaint) return;
  const baseStatus = data.status || statusFallback || 'confirmed';
  const baseContract = data.contract || null;
  const baseSender = data.sender || null;
  const baseTxHash = data.txHash || data.txId || null;
  const paints = Array.isArray(data.paints) ? data.paints : [data];

  paints.forEach((paint) => {
    const x = Number(paint.x);
    const y = Number(paint.y);
    const color = String(paint.color || '').toLowerCase();
    const contract = paint.contract || baseContract;
    if (contractName && contract && contract !== contractName) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    onPaint({
      x,
      y,
      color,
      sender: paint.sender || baseSender,
      txHash: paint.txHash || baseTxHash || null,
      status: paint.status || baseStatus,
      contract,
    });
  });
}

function startLiveFeedSse({ liveUrl, contractName, onPaint, onStatus }) {
  let source = null;

  const notify = (msg) => {
    try { onStatus && onStatus(msg); } catch (_) {}
    try { console.debug('[live-feed]', msg); } catch (_) {}
  };

  try {
    source = new EventSource(liveUrl);
  } catch (e) {
    notify(`SSE create error: ${String(e)}`);
    return () => {};
  }

  source.onopen = () => {
    notify('Live feed connected');
  };

  source.onerror = () => {
    notify('Live feed error; reconnecting...');
  };

  source.addEventListener('paint', (evt) => {
    try {
      const data = JSON.parse(evt.data || '{}');
      emitPaints({ data, statusFallback: 'confirmed', contractName, onPaint });
    } catch {}
  });

  source.addEventListener('pending', (evt) => {
    try {
      const data = JSON.parse(evt.data || '{}');
      emitPaints({ data, statusFallback: 'pending', contractName, onPaint });
    } catch {}
  });

  source.addEventListener('hello', () => {});
  source.addEventListener('ping', () => {});

  return () => {
    try { source && source.close(); } catch {}
  };
}

export function startHathorPaintMonitor({
  wsUrl = (process.env.NEXT_PUBLIC_HATHOR_WS_URL || ''),
  liveUrl = (process.env.NEXT_PUBLIC_LIVE_FEED_URL || ''),
  contractName,
  onPaint,
  onContractTx,
  onStatus,
}) {
  if (typeof window === 'undefined') return () => {};
  if (liveUrl && typeof EventSource !== 'undefined') {
    return startLiveFeedSse({ liveUrl, contractName, onPaint, onStatus });
  }
  if (!wsUrl) {
    try { console.info('[hathor-ws] No websocket URL configured; realtime updates disabled.'); } catch (_) {}
    try { onStatus && onStatus('Realtime updates disabled (no Hathor WS URL)'); } catch (_) {}
    return () => {};
  }
  const sanitizedWsUrl = (() => {
    const hashIndex = wsUrl.indexOf('#');
    return hashIndex >= 0 ? wsUrl.slice(0, hashIndex) : wsUrl;
  })();
  let socket = null;
  let alive = true;
  let reconnectDelayMs = 1000;
  const processed = new Set();

  const notify = (msg) => {
    try { onStatus && onStatus(msg); } catch (_) {}
    try { console.debug('[hathor-ws]', msg); } catch (_) {}
  };

  const subscribeMsg = JSON.stringify({
    jsonrpc: '2.0',
    method: 'subscribe',
    id: 1,
    params: { query: "tm.event='Tx'" },
  });

  function connect() {
    if (!alive) return;
    try {
      socket = new WebSocket(sanitizedWsUrl);
    } catch (e) {
      notify(`WS create error: ${String(e)}`);
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      try { socket.send(subscribeMsg); } catch {}
      notify('Subscribed to Tx events');
      reconnectDelayMs = 1000;
    };

    socket.onmessage = (evt) => {
      let obj;
      try { obj = JSON.parse(evt.data); } catch { return; }
      const { txHash, txB64 } = extractTxData(obj);
      if (!txB64) return;
      if (txHash && processed.has(txHash)) return;

      const txJson = decodeTxB64ToJson(txB64);
      if (!txJson) {
        if (txHash) processed.add(txHash);
        return;
      }

      const payload = txJson?.payload || {};
      const c = payload.contract;
      const f = payload.function;
      const k = payload.kwargs || {};

      if (c === contractName) {
        try { onContractTx && onContractTx(payload); } catch (_) {}

        if (f === 'paint') {
          const x = Number(k.x);
          const y = Number(k.y);
          const color = String(k.color || '').toLowerCase();
          if (Number.isFinite(x) && Number.isFinite(y)) {
            try {
              onPaint && onPaint({
                x,
                y,
                color,
                sender: payload.sender,
                txHash: txHash || null,
                status: 'confirmed',
                contract: payload.contract,
              });
            } catch (_) {}
          }
        }
        if (f === 'paint_batch') {
          const xs = Array.isArray(k.xs) ? k.xs : [];
          const ys = Array.isArray(k.ys) ? k.ys : [];
          const colors = Array.isArray(k.colors) ? k.colors : [];
          const count = Math.min(xs.length, ys.length, colors.length);
          for (let i = 0; i < count; i++) {
            const x = Number(xs[i]);
            const y = Number(ys[i]);
            const color = String(colors[i] || '').toLowerCase();
            if (Number.isFinite(x) && Number.isFinite(y)) {
              try {
                onPaint && onPaint({
                  x,
                  y,
                  color,
                  sender: payload.sender,
                  txHash: txHash || null,
                  status: 'confirmed',
                  contract: payload.contract,
                });
              } catch (_) {}
            }
          }
        }
        if (txHash) processed.add(txHash);
        return;
      }

      if (txHash) processed.add(txHash);
    };

    socket.onerror = (e) => {
      notify(`WS error: ${e?.message || 'unknown'}`);
    };

    socket.onclose = (evt) => {
      notify(`WS closed (${evt?.code || ''} ${evt?.reason || ''}), reconnecting...`);
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (!alive) return;
    setTimeout(() => {
      if (!alive) return;
      reconnectDelayMs = Math.min(reconnectDelayMs * 1.5, 15000);
      connect();
    }, reconnectDelayMs);
  }

  connect();

  return () => {
    alive = false;
    try { socket && socket.close(); } catch {}
  };
}
