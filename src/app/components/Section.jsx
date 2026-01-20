'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CONTRACT_NAME,
    DEFAULT_SIZE,
    DEPOSIT_AMOUNT,
    DEPOSIT_TOKEN,
    PIXEL_PRICE_WEI,
    WALLET_API_BASE,
    WALLET_ID,
} from '@/app/lib/addresses';
import { usePixelLoadingAnimation } from './PixelLoadingAnimation';
import useStore from '@/app/lib/store';
import { sendNanoContractTxRpcRequest } from '@hathor/hathor-rpc-handler';
import { useWalletConnectClient } from '@/app/lib/walletconnect/ClientContext';
import { useJsonRpc } from '@/app/lib/walletconnect/JsonRpcContext';
import { getAccountFromSession } from '@/app/lib/walletconnect/utils';
import { startHathorPaintMonitor } from '@/app/lib/js/hathor-ws-monitor';

const DEFAULT_PIXEL_SIZE = 10;
const DEFAULT_CANVAS_SIZE = Number(process.env.NEXT_PUBLIC_CANVAS_SIZE || DEFAULT_SIZE || 32);
const configuredBatchSize = Number(process.env.NEXT_PUBLIC_BATCH_LIMIT || 32);
const DRAFT_TTL_MS = (() => {
    const parsed = Number(process.env.NEXT_PUBLIC_LIVE_FEED_DRAFT_TTL_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 45000;
})();
const NC_STATE_TIMEOUT_MS = (() => {
    const parsed = Number(process.env.NEXT_PUBLIC_NC_STATE_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15000;
})();
const NC_STATE_BACKEND = String(process.env.NEXT_PUBLIC_NC_STATE_BACKEND || 'auto').toLowerCase();
const PIXELS_PAGE_SIZE = (() => {
    const parsed = Number(process.env.NEXT_PUBLIC_PIXELS_PAGE_SIZE);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 1000;
})();
const PIXELS_PAGE_MAX_PAGES = (() => {
    const parsed = Number(process.env.NEXT_PUBLIC_PIXELS_PAGE_MAX_PAGES);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 400;
})();
const PIXELS_PAGE_CALLS_PER_REQUEST = (() => {
    const parsed = Number(process.env.NEXT_PUBLIC_PIXELS_PAGE_CALLS_PER_REQUEST);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 25) : 5;
})();
const MAX_BATCH_SIZE = Math.min(
    Number.isFinite(configuredBatchSize) && configuredBatchSize > 0 ? configuredBatchSize : 32,
    32
);
const PENDING_TX_STORAGE_KEY = 'pxiel-pending-tx';
const PENDING_TX_TTL_MS = (() => {
    const parsed = Number(process.env.NEXT_PUBLIC_PENDING_TX_TTL_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 60 * 1000; // 5 minutes default
})();

// Helper functions for pending transaction localStorage persistence
function loadPendingTxFromStorage() {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(PENDING_TX_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function savePendingTxToStorage(pendingList) {
    if (typeof localStorage === 'undefined') return;
    try {
        if (!pendingList || pendingList.length === 0) {
            localStorage.removeItem(PENDING_TX_STORAGE_KEY);
        } else {
            localStorage.setItem(PENDING_TX_STORAGE_KEY, JSON.stringify(pendingList));
        }
    } catch { }
}

function cleanExpiredPendingTx(pendingList) {
    const now = Date.now();
    return pendingList.filter(tx => {
        const age = now - (tx.timestamp || 0);
        return age < PENDING_TX_TTL_MS;
    });
}

export default function Section() {

    const canvasRef = useRef(null);
    const pendingTimersRef = useRef(new Map());
    const storeWalletId = useStore(state => state.walletId);
    const storeWalletAddress = useStore(state => state.walletAddress);
    const setStoreWalletId = useStore(state => state.setWalletId);
    const setStoreWalletAddress = useStore(state => state.setWalletAddress);
    const [chainPixels, setChainPixels] = useState(new Map());
    const [pendingPaints, setPendingPaints] = useState(new Map());
    const [queuedPaints, setQueuedPaints] = useState(new Map());
    const [selected, setSelected] = useState('#ffffff');
    const [isMounted, setIsMounted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const { loadingPixels, setLoadingPixels, generateLoadingPixels, drawLoadingAnimation } = usePixelLoadingAnimation();
    const [txStatus, setTxStatus] = useState('');
    const [realtimeStatus, setRealtimeStatus] = useState('');
    const [canvasSize, setCanvasSize] = useState(DEFAULT_CANVAS_SIZE);
    const [paintCount, setPaintCount] = useState(0);
    const [feeAmount, setFeeAmount] = useState(Number(DEPOSIT_AMOUNT || PIXEL_PRICE_WEI || 0));
    const [feesCollected, setFeesCollected] = useState(0);
    const [ownerAddress, setOwnerAddress] = useState(null);
    const [isWithdrawing, setIsWithdrawing] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 50, y: 50 }); // Start with (0,0) at top-left with small margin
    const [isPanning, setIsPanning] = useState(false);
    const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
    const [hoveredPixel, setHoveredPixel] = useState(null);
    const [showControls, setShowControls] = useState(true);
    const [isCommitting, setIsCommitting] = useState(false);
    const [ctrlPressed, setCtrlPressed] = useState(false);
    const [mouseDownPos, setMouseDownPos] = useState(null);
    const [hasDragged, setHasDragged] = useState(false);
    const walletApiBase = useMemo(() => (WALLET_API_BASE || '').replace(/\/$/, ''), []);
    const walletId = storeWalletId || WALLET_ID || 'alice';
    const depositToken = DEPOSIT_TOKEN || '00';
    const depositAmount = Number(DEPOSIT_AMOUNT || PIXEL_PRICE_WEI || 100);
    const perPixelFee = Number.isFinite(feeAmount) && feeAmount > 0 ? feeAmount : depositAmount;
    const queuedCount = queuedPaints.size;
    const batchTotalFee = queuedCount * perPixelFee;
    const contractId = CONTRACT_NAME;
    const blueprintId = process.env.NEXT_PUBLIC_BLUEPRINT_ID || null;
    const liveFeedUrl = process.env.NEXT_PUBLIC_LIVE_FEED_URL || '';
    const liveFeedSecret = process.env.NEXT_PUBLIC_LIVE_FEED_SECRET || '';
    const liveFeedPostUrl = useMemo(() => {
        if (!liveFeedUrl) return '';
        try {
            const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
            const url = new URL(liveFeedUrl, base);
            if (url.pathname.endsWith('/live/')) {
                url.pathname = url.pathname.replace(/\/live\/$/, '/pending');
            } else if (url.pathname.endsWith('/live')) {
                url.pathname = url.pathname.replace(/\/live$/, '/pending');
            } else {
                url.pathname = url.pathname.replace(/\/$/, '') + '/pending';
            }
            return url.toString();
        } catch {
            return '';
        }
    }, [liveFeedUrl]);
    const indexerSnapshotUrl = useMemo(() => {
        const override = process.env.NEXT_PUBLIC_INDEXER_URL || '';
        if (override) return override;
        if (!liveFeedUrl) return '';
        try {
            const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
            const url = new URL(liveFeedUrl, base);
            if (url.pathname.endsWith('/live/')) {
                url.pathname = url.pathname.replace(/\/live\/$/, '/snapshot');
            } else if (url.pathname.endsWith('/live')) {
                url.pathname = url.pathname.replace(/\/live$/, '/snapshot');
            } else {
                url.pathname = url.pathname.replace(/\/$/, '') + '/snapshot';
            }
            return url.toString();
        } catch {
            return '';
        }
    }, [liveFeedUrl]);
    const { session, connect: establishSession } = useWalletConnectClient();
    const { hathorRpc } = useJsonRpc();
    const sessionAccount = useMemo(() => getAccountFromSession(session), [session]);
    const connectedAddress = storeWalletAddress || sessionAccount?.address || null;
    const isWalletConnected = Boolean(session && connectedAddress);
    const normalizeAddress = useCallback((value) => String(value || '').trim(), []);
    const isOwner = useMemo(() => {
        if (!connectedAddress || !ownerAddress) return false;
        return normalizeAddress(connectedAddress) === normalizeAddress(ownerAddress);
    }, [connectedAddress, ownerAddress, normalizeAddress]);

    useEffect(() => {
        if (!connectedAddress && !ownerAddress) return;
        const normalizedConnected = normalizeAddress(connectedAddress);
        const normalizedOwner = normalizeAddress(ownerAddress);
        const match = Boolean(normalizedConnected && normalizedOwner && normalizedConnected === normalizedOwner);
        console.info('[owner-check] compare', {
            connectedAddress: normalizedConnected || null,
            ownerAddress: normalizedOwner || null,
            isOwner: match,
        });
    }, [connectedAddress, ownerAddress, normalizeAddress]);

    const clearPendingTimer = useCallback((key) => {
        const timers = pendingTimersRef.current;
        const existing = timers.get(key);
        if (existing) {
            try { clearTimeout(existing); } catch { }
        }
        timers.delete(key);
    }, []);

    const scheduleDraftExpiry = useCallback((key) => {
        if (!Number.isFinite(DRAFT_TTL_MS) || DRAFT_TTL_MS <= 0) return;
        const timers = pendingTimersRef.current;
        clearPendingTimer(key);
        const timer = setTimeout(() => {
            timers.delete(key);
            setPendingPaints(prev => {
                if (!prev.has(key)) return prev;
                const next = new Map(prev);
                next.delete(key);
                return next;
            });
        }, DRAFT_TTL_MS);
        timers.set(key, timer);
    }, [clearPendingTimer]);

    useEffect(() => () => {
        const timers = pendingTimersRef.current;
        timers.forEach((timer) => {
            try { clearTimeout(timer); } catch { }
        });
        timers.clear();
    }, []);

    const renderPixels = useMemo(() => {
        const merged = new Map(chainPixels);
        pendingPaints.forEach((color, key) => merged.set(key, color));
        queuedPaints.forEach((entry, key) => merged.set(key, entry.color));
        return merged;
    }, [chainPixels, pendingPaints, queuedPaints]);
    useEffect(() => {
        const parsed = getAccountFromSession(session);
        if (parsed?.address) {
            setStoreWalletAddress(parsed.address);
        }
    }, [session, setStoreWalletAddress]);

    useEffect(() => {
        if (!contractId) return undefined;
        const stop = startHathorPaintMonitor({
            contractName: contractId,
            onPaint: ({ x, y, color, status, txHash }) => {
                if (!Number.isFinite(x) || !Number.isFinite(y) || typeof color !== 'string') return;
                const key = `${x}:${y}`;
                const normalized = color.toLowerCase();
                const paintStatus = status || 'confirmed';

                if (paintStatus === 'pending') {
                    setPendingPaints(prev => {
                        const next = new Map(prev);
                        next.set(key, normalized);
                        return next;
                    });
                    if (!txHash) {
                        scheduleDraftExpiry(key);
                    } else {
                        clearPendingTimer(key);
                    }
                    return;
                }

                setChainPixels(prev => {
                    const next = new Map(prev);
                    next.set(key, normalized);
                    return next;
                });
                setPendingPaints(prev => {
                    if (!prev.has(key)) return prev;
                    const next = new Map(prev);
                    next.delete(key);
                    return next;
                });
                clearPendingTimer(key);
                setQueuedPaints(prev => {
                    if (!prev.has(key)) return prev;
                    const existing = prev.get(key);
                    if (existing && existing.color.toLowerCase() === normalized) {
                        const nextQueue = new Map(prev);
                        nextQueue.delete(key);
                        return nextQueue;
                    }
                    return prev;
                });
            },
            onStatus: (msg) => setRealtimeStatus(msg || ''),
        });
        return () => {
            if (typeof stop === 'function') stop();
        };
    }, [contractId, scheduleDraftExpiry, clearPendingTimer]);

    const pixelSize = DEFAULT_PIXEL_SIZE * zoom;

    // Draw the canvas
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);


        const g1 = ctx.createRadialGradient(width * 0.7, -200, 0, width * 0.7, -200, Math.max(width, height));
        g1.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
        g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, width, height);

        const g2 = ctx.createRadialGradient(-200, height * 0.8, 0, -200, height * 0.8, Math.max(width, height));
        g2.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
        g2.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;

        const startX = offset.x % pixelSize;
        const startY = offset.y % pixelSize;

        for (let x = startX; x < width; x += pixelSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        for (let y = startY; y < height; y += pixelSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Draw pixels (chain + queued)
        renderPixels.forEach((color, key) => {
            const [px, py] = key.split(':').map(Number);
            const screenX = px * pixelSize + offset.x;
            const screenY = py * pixelSize + offset.y;

            if (screenX > -pixelSize && screenX < width &&
                screenY > -pixelSize && screenY < height) {
                ctx.fillStyle = color;
                // Add a small gap (1.5px) between pixels for better visibility
                ctx.fillRect(screenX + 0.5, screenY + 0.5, pixelSize - 1.5, pixelSize - 1.5);
            }
        });

        // Draw canvas border to show limits (subtle, less prominent)
        const borderX = offset.x;
        const borderY = offset.y;
        const borderSize = canvasSize * pixelSize;

        // Outer subtle white border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(borderX, borderY, borderSize, borderSize);

        // Inner faint pink accent border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(borderX + 1, borderY + 1, borderSize - 2, borderSize - 2);

        // Draw grid lines for better pixel visualization when zoomed in
        if (zoom > 2) {
            ctx.strokeStyle = '#444444';
            ctx.lineWidth = 0.5;
            ctx.globalAlpha = 0.3;

            // Vertical lines
            for (let x = 0; x <= canvasSize; x += 10) {
                const lineX = borderX + x * pixelSize;
                ctx.beginPath();
                ctx.moveTo(lineX, borderY);
                ctx.lineTo(lineX, borderY + borderSize);
                ctx.stroke();
            }

            // Horizontal lines  
            for (let y = 0; y <= canvasSize; y += 10) {
                const lineY = borderY + y * pixelSize;
                ctx.beginPath();
                ctx.moveTo(borderX, lineY);
                ctx.lineTo(borderX + borderSize, lineY);
                ctx.stroke();
            }

            ctx.globalAlpha = 1.0;
        }

        // Draw loading animation
        if (loading) {
            const canvas = canvasRef.current;
            drawLoadingAnimation(ctx, {
                isLoading: loading,
                progress: loadingProgress,
                offset,
                pixelSize,
                canvasWidth: canvas?.width || 0,
                canvasHeight: canvas?.height || 0,
                loadingPixels
            });
        }

        // Draw hover effect
        if (hoveredPixel && !loading) {
            const screenX = hoveredPixel.x * pixelSize + offset.x;
            const screenY = hoveredPixel.y * pixelSize + offset.y;

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(screenX - 1, screenY - 1, pixelSize + 1, pixelSize + 1);

            // Draw coordinates
            ctx.fillStyle = '#f5f5f5';
            ctx.font = '12px "Press Start 2P", monospace';
            ctx.fillText(`(${hoveredPixel.x}, ${hoveredPixel.y})`, screenX + pixelSize + 5, screenY + pixelSize / 2);
        }
    }, [renderPixels, offset, zoom, pixelSize, hoveredPixel, loading, loadingProgress, loadingPixels, drawLoadingAnimation, canvasSize]);

    // Canvas resize handler
    useEffect(() => {
        const handleResize = () => {
            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                draw();
            }
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [draw]);

    // Nano contract state helpers (node API via proxy to avoid CORS)
    const callNanoContractState = useCallback(async ({ calls = [], fields = [] } = {}) => {
        if (!contractId) {
            throw new Error('Contract ID missing.');
        }

        const wantsPixels = Array.isArray(fields) && fields.includes('pixels');
        const backends = NC_STATE_BACKEND === 'wallet'
            ? ['wallet']
            : (NC_STATE_BACKEND === 'node' ? ['node'] : ['node', 'wallet']);

        const fetchState = async (backend) => {
            const params = new URLSearchParams();
            params.set('id', contractId);
            for (const call of calls) {
                params.append('calls[]', call);
            }
            for (const field of fields) {
                params.append('fields[]', field);
            }

            const url = backend === 'wallet'
                ? `${walletApiBase}/wallet/nano-contracts/state?${params.toString()}`
                : `/api/node/nano_contract/state?${params.toString()}`;

            let res;
            let text = '';
            let json = {};
            let requestError = null;
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timeout = controller ? setTimeout(() => controller.abort(), NC_STATE_TIMEOUT_MS) : null;
            try {
                const headers = backend === 'wallet' && walletId ? { 'x-wallet-id': walletId } : undefined;
                const fetchOpts = {
                    ...(controller ? { signal: controller.signal } : null),
                    ...(headers ? { headers } : null),
                };
                res = await fetch(url, fetchOpts);
                text = await res.text();
                json = JSON.parse(text);
            } catch (e) {
                requestError = e;
                console.error('Failed to parse response:', e);
            } finally {
                if (timeout) {
                    try { clearTimeout(timeout); } catch { }
                }
            }

            if (!res || !res.ok) {
                const aborted = requestError && typeof requestError === 'object' && requestError.name === 'AbortError';
                if (aborted) {
                    throw new Error(`Nano contract state request timed out after ${NC_STATE_TIMEOUT_MS}ms.`);
                }
                const msg = json?.error || json?.message || text || `Error getting nano contract state (${res?.status || 'n/a'})`;
                console.error('callNanoContractState failed', { backend, url, status: res?.status, msg, body: text });
                throw new Error(msg);
            }

            const payload = (json && typeof json === 'object' && json.state && typeof json.state === 'object')
                ? json.state
                : json;

            if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'success') && payload.success === false) {
                const msg = payload?.error || payload?.message || 'Nano contract state request failed.';
                throw new Error(msg);
            }

            return payload || {};
        };

        let lastError = null;
        for (const backend of backends) {
            try {
                const state = await fetchState(backend);
                if (NC_STATE_BACKEND === 'auto' && backend === 'node' && wantsPixels) {
                    const pixelsField = state?.fields?.pixels;
                    if (pixelsField === undefined || pixelsField === null) {
                        try {
                            const walletState = await fetchState('wallet');
                            const walletPixelsField = walletState?.fields?.pixels;
                            if (walletPixelsField !== undefined && walletPixelsField !== null) {
                                return walletState || state;
                            }
                        } catch {
                            // ignore wallet fallback errors; keep node response
                        }
                    }
                }
                return state;
            } catch (err) {
                lastError = err;
            }
        }

        throw lastError || new Error('Failed to load nano contract state.');
    }, [contractId, walletApiBase, walletId]);

    const applyStats = useCallback((statsVal) => {
        if (!statsVal) return;
        // Support tuple response [size, fee]
        const sizeFromTuple = Array.isArray(statsVal) && statsVal.length >= 1 ? Number(statsVal[0]) : null;
        const feeFromTuple = Array.isArray(statsVal) && statsVal.length >= 2 ? Number(statsVal[1]) : null;

        const size = Number(
            (statsVal && typeof statsVal === 'object'
                ? (statsVal.size ?? statsVal.canvas_size ?? statsVal.board_size ?? statsVal.max_size)
                : undefined) ?? sizeFromTuple
        );
        if (Number.isFinite(size) && size > 1) {
            setCanvasSize(size);
        } else {
            setCanvasSize(DEFAULT_CANVAS_SIZE);
        }
        const paints = Number(
            statsVal && typeof statsVal === 'object'
                ? (statsVal.paint_count ?? statsVal.painted ?? statsVal.painted_pixels)
                : NaN
        );
        if (Number.isFinite(paints)) setPaintCount(paints);
        const fee = Number(
            (statsVal && typeof statsVal === 'object'
                ? (statsVal.fee ?? statsVal.fee_amount ?? statsVal.pixel_price ?? statsVal.price)
                : undefined) ?? feeFromTuple
        );
        if (Number.isFinite(fee)) setFeeAmount(fee);

        const collected = Number(
            statsVal && typeof statsVal === 'object'
                ? (statsVal.fees_collected ?? statsVal.feesCollected ?? statsVal.total_fees)
                : NaN
        );
        if (Number.isFinite(collected)) setFeesCollected(collected);
    }, []);

    const loadContractMetaOnly = useCallback(async () => {
        try {
            const state = await callNanoContractState({
                fields: ['paint_count', 'fees_collected', 'size', 'fee_htr', 'owner'],
                calls: ['get_stats()', 'get_owner()'],
            });
            console.info('[owner-check] state response', {
                fields: state?.fields ?? null,
                calls: state?.calls ?? null,
            });
            const fields = state?.fields || {};
            const calls = state?.calls || {};

            const unwrap = (val) => {
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
            };

            const extractCall = (prefix) => {
                if (Array.isArray(calls)) {
                    const item = calls.find((entry) => {
                        if (!entry) return false;
                        const key = entry.call || entry.method || entry.name || '';
                        return typeof key === 'string' && key.startsWith(prefix);
                    });
                    return item ? unwrap(item.result ?? item.value ?? item) : null;
                }
                if (calls && typeof calls === 'object') {
                    const callKey = Object.keys(calls).find((k) => typeof k === 'string' && k.startsWith(prefix));
                    if (!callKey) return null;
                    const val = calls[callKey];
                    return unwrap(val?.result ?? val?.value ?? val);
                }
                return null;
            };

            const statsFromCall = extractCall('get_stats');
            const ownerFromCall = extractCall('get_owner');

            const statsVal = {
                size: unwrap(fields.size),
                paint_count: unwrap(fields.paint_count),
                fee: unwrap(fields.fee_htr),
                fees_collected: unwrap(fields.fees_collected),
            };

            if (statsFromCall) {
                if (!statsVal.paint_count) {
                    if (Array.isArray(statsFromCall)) {
                        statsVal.paint_count = statsFromCall?.[0];
                    } else {
                        statsVal.paint_count = statsFromCall.paint_count ?? statsFromCall.painted ?? null;
                    }
                }
                if (!statsVal.fees_collected) {
                    if (Array.isArray(statsFromCall)) {
                        statsVal.fees_collected = statsFromCall?.[1];
                    } else {
                        statsVal.fees_collected = statsFromCall.fees_collected ?? statsFromCall.total_fees ?? null;
                    }
                }
            }

            applyStats(statsVal);

            const ownerFieldVal = unwrap(fields.owner);
            const owner = ownerFromCall ?? ownerFieldVal;
            if (owner) setOwnerAddress(String(owner));
        } catch (err) {
            console.warn('Failed to refresh contract metadata', err);
        }
    }, [callNanoContractState, applyStats]);

    const loadCanvasViaWalletApi = useCallback(async () => {
        if (!walletId) {
            setTxStatus('Set Wallet ID (X-Wallet-Id) to load the canvas.');
            return;
        }
        setLoading(true);
        setLoadingProgress(0);
        setLoadingPixels([]);
        setPendingPaints(new Map());

        try {
            const loadIndexerSnapshot = async () => {
                if (!indexerSnapshotUrl) return null;
                try {
                    const res = await fetch(indexerSnapshotUrl, { cache: 'no-store' });
                    const json = await res.json();
                    if (!res.ok || (json && json.ok === false)) return null;
                    return json || null;
                } catch (err) {
                    console.warn('Indexer snapshot failed', err);
                    return null;
                }
            };

            const parseIndexerPixels = (raw) => {
                const pixelsMap = new Map();
                if (!raw) return pixelsMap;

                const upsert = (x, y, color) => {
                    const px = Number(x);
                    const py = Number(y);
                    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
                    if (typeof color !== 'string' || !color) return;
                    pixelsMap.set(`${px}:${py}`, color.toLowerCase());
                };

                const parseKey = (key) => {
                    const str = String(key ?? '');
                    const match = str.match(/(-?\d+)[^\d-]+(-?\d+)/);
                    if (!match) return null;
                    return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
                };

                if (Array.isArray(raw)) {
                    raw.forEach((item) => {
                        if (!item) return;
                        if (Array.isArray(item)) {
                            if (item.length >= 3) {
                                upsert(item[0], item[1], item[2]);
                                return;
                            }
                            if (item.length >= 2) {
                                const coords = parseKey(item[0]);
                                if (coords) upsert(coords.x, coords.y, item[1]);
                                return;
                            }
                        }
                        if (typeof item === 'object') {
                            if ('x' in item && 'y' in item) {
                                upsert(item.x, item.y, item.color);
                                return;
                            }
                            const coords = parseKey(item.key ?? item.k ?? item.coord ?? item.coords);
                            if (coords) upsert(coords.x, coords.y, item.color ?? item.value ?? item.v);
                        }
                    });
                    return pixelsMap;
                }

                if (typeof raw === 'object') {
                    Object.entries(raw).forEach(([key, value]) => {
                        const coords = parseKey(key);
                        if (!coords) return;
                        const color = typeof value === 'string' ? value : (value?.color ?? value?.value ?? value?.result ?? value);
                        upsert(coords.x, coords.y, color);
                    });
                }

                return pixelsMap;
            };

            const indexerSnapshot = await loadIndexerSnapshot();
            if (indexerSnapshot && Object.prototype.hasOwnProperty.call(indexerSnapshot, 'pixels')) {
                const rawPixels = indexerSnapshot.pixels ?? indexerSnapshot.snapshot?.pixels ?? indexerSnapshot.data?.pixels;
                const pixelsFromIndexer = parseIndexerPixels(rawPixels);
                setChainPixels(pixelsFromIndexer);
                const paintCountVal = Number(indexerSnapshot.paint_count ?? indexerSnapshot.painted ?? pixelsFromIndexer.size);
                if (Number.isFinite(paintCountVal)) setPaintCount(paintCountVal);
                if (pixelsFromIndexer.size > 0) {
                    setTxStatus(`Loaded ${pixelsFromIndexer.size} pixels from indexer.`);
                } else {
                    setTxStatus('Canvas loaded from indexer. Board is empty.');
                }

                // Clean up localStorage pending transactions - remove any that are now confirmed
                const storedPendingTx = loadPendingTxFromStorage();
                if (storedPendingTx.length > 0) {
                    const stillPendingTx = storedPendingTx.filter(tx => {
                        if (!Array.isArray(tx.paints)) return false;
                        // Keep if ANY paint is not yet in chain
                        return tx.paints.some(paint => {
                            const key = `${paint.x}:${paint.y}`;
                            const chainColor = pixelsFromIndexer.get(key);
                            return !chainColor || chainColor !== paint.color.toLowerCase();
                        });
                    });
                    // Also clean expired
                    const validPendingTx = cleanExpiredPendingTx(stillPendingTx);
                    if (validPendingTx.length !== storedPendingTx.length) {
                        savePendingTxToStorage(validPendingTx);
                    }
                    // Remove confirmed pixels from pendingPaints state
                    setPendingPaints(prev => {
                        const next = new Map(prev);
                        let changed = false;
                        prev.forEach((color, key) => {
                            const chainColor = pixelsFromIndexer.get(key);
                            if (chainColor && chainColor === color) {
                                next.delete(key);
                                changed = true;
                            }
                        });
                        return changed ? next : prev;
                    });
                }

                // Also load pending paints from server snapshot if provided
                const serverPending = indexerSnapshot.pending;
                if (Array.isArray(serverPending) && serverPending.length > 0) {
                    const pendingFromServer = new Map();
                    serverPending.forEach(tx => {
                        if (!Array.isArray(tx.paints)) return;
                        tx.paints.forEach(paint => {
                            const key = `${paint.x}:${paint.y}`;
                            // Only add if not already confirmed on chain
                            const chainColor = pixelsFromIndexer.get(key);
                            if (!chainColor || chainColor !== paint.color) {
                                pendingFromServer.set(key, paint.color);
                            }
                        });
                    });
                    if (pendingFromServer.size > 0) {
                        setPendingPaints(prev => {
                            const next = new Map(prev);
                            pendingFromServer.forEach((color, key) => next.set(key, color));
                            return next;
                        });
                    }
                }

                loadContractMetaOnly();
                return;
            }


            const unwrapValue = (val) => {
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
            };

            const coerceNumber = (val) => {
                const num = typeof val === 'number' ? val : Number(val);
                return Number.isFinite(num) ? num : null;
            };

            const parseCoords = (rawKey) => {
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
            };

            const parsePixelsField = (raw) => {
                const pixelsMap = new Map();
                if (raw === null || raw === undefined) return pixelsMap;

                const rawUnwrapped = unwrapValue(raw);

                const upsert = (k, v) => {
                    const coords = parseCoords(k);
                    if (!coords) return;
                    const unwrapped = unwrapValue(v);
                    let color = typeof unwrapped === 'string'
                        ? unwrapped
                        : (unwrapped && typeof unwrapped === 'object'
                            ? (unwrapped.color ?? unwrapped.value ?? unwrapped.result)
                            : null);
                    if (color && typeof color !== 'string') {
                        color = unwrapValue(color);
                    }
                    if (typeof color !== 'string' || !color) return;
                    pixelsMap.set(`${coords.x}:${coords.y}`, color.toLowerCase());
                };

                if (Array.isArray(rawUnwrapped)) {
                    rawUnwrapped.forEach((item) => {
                        if (!item) return;
                        if (Array.isArray(item) && item.length >= 2) {
                            upsert(item[0], item[1]);
                            return;
                        }
                        if (typeof item === 'object') {
                            upsert(item.key ?? item.k ?? item.coord ?? item.coords, item.value ?? item.v ?? item.color);
                        }
                    });
                    return pixelsMap;
                }

                if (typeof rawUnwrapped === 'object') {
                    Object.entries(rawUnwrapped).forEach(([k, v]) => upsert(k, v));
                }
                return pixelsMap;
            };

            // First pass: Get stats to know the board size
            const statsState = await callNanoContractState({
                fields: ['paint_count', 'fees_collected', 'size', 'fee_htr', 'pixels', 'owner'],
                calls: ['get_stats()', 'get_owner()']
            });
            console.log('Nano Contract Stats Loaded:', statsState);
            const fields = statsState?.fields || {};
            const calls = statsState?.calls || {};

            let statsFromCall = null;
            if (Array.isArray(calls)) {
                // ... same stats parsing logic as before ...
                const item = calls.find((entry) => {
                    if (!entry) return false;
                    const key = entry.call || entry.method || entry.name || '';
                    return typeof key === 'string' && key.startsWith('get_stats');
                });
                statsFromCall = item ? (item.result ?? item.value ?? null) : null;
            } else {
                const callKey = Object.keys(calls).find((k) => typeof k === 'string' && k.startsWith('get_stats'));
                if (callKey) {
                    const val = calls[callKey];
                    statsFromCall = val?.result ?? val?.value ?? val;
                }
            }

            let ownerFromCall = null;
            if (Array.isArray(calls)) {
                const item = calls.find((entry) => {
                    if (!entry) return false;
                    const key = entry.call || entry.method || entry.name || '';
                    return typeof key === 'string' && key.startsWith('get_owner');
                });
                ownerFromCall = item ? (item.result ?? item.value ?? null) : null;
            } else {
                const callKey = Object.keys(calls).find((k) => typeof k === 'string' && k.startsWith('get_owner'));
                if (callKey) {
                    const val = calls[callKey];
                    ownerFromCall = val?.result ?? val?.value ?? val;
                }
            }

            const statsVal = {
                size: fields.size?.value,
                paint_count: fields.paint_count?.value,
                fee: fields.fee_htr?.value,
                fees_collected: fields.fees_collected?.value,
            };

            // Extract values from tuple if needed
            if (statsFromCall) {
                if (!statsVal.paint_count) {
                    if (Array.isArray(statsFromCall)) {
                        statsVal.paint_count = statsFromCall?.[0];
                    } else {
                        statsVal.paint_count = statsFromCall.paint_count ?? statsFromCall.painted ?? null;
                    }
                }
                if (!statsVal.fees_collected) {
                    if (Array.isArray(statsFromCall)) {
                        statsVal.fees_collected = statsFromCall?.[1];
                    } else {
                        statsVal.fees_collected = statsFromCall.fees_collected ?? statsFromCall.total_fees ?? null;
                    }
                }
            }
            applyStats(statsVal);

            const ownerFieldVal = fields.owner?.value ?? fields.owner ?? null;
            const ownerCandidate = ownerFromCall ?? ownerFieldVal;
            if (ownerCandidate) {
                const ownerVal = (ownerCandidate && typeof ownerCandidate === 'object')
                    ? (ownerCandidate.value ?? ownerCandidate.result ?? ownerCandidate.address ?? ownerCandidate)
                    : ownerCandidate;
                console.info('[owner-check] owner resolved', {
                    ownerFromCall: ownerFromCall ?? null,
                    ownerFieldVal: ownerFieldVal ?? null,
                    ownerResolved: ownerVal ?? null,
                });
                if (ownerVal) setOwnerAddress(String(ownerVal));
            }

            const currentSize = Number(statsVal.size) || canvasSize || 10;
            const pCount = Number(statsVal.paint_count || 0);

            const pixelsField = fields?.pixels;
            const pixelsRaw = pixelsField?.value ?? pixelsField;
            const pixelsFromState = parsePixelsField(pixelsRaw);
            const hasPixelsField = pixelsField !== undefined && pixelsField !== null;
            if (hasPixelsField && (pixelsFromState.size > 0 || pCount === 0)) {
                setChainPixels(pixelsFromState);
                if (pixelsFromState.size > 0) {
                    setTxStatus(`Loaded ${pixelsFromState.size} pixels. Size: ${currentSize}.`);
                } else {
                    setTxStatus(`Canvas loaded. Board is empty (0 paints). Size: ${currentSize}.`);
                }
                return;
            }

            // Second pass: If we have paints, try to load painted pixels sparsely
            if (pCount > 0) {
                const extractCallValue = (callsResult, prefix) => {
                    if (!callsResult) return null;
                    if (Array.isArray(callsResult)) {
                        const item = callsResult.find((entry) => {
                            if (!entry) return false;
                            const key = entry.call || entry.method || entry.name || '';
                            return typeof key === 'string' && key.startsWith(prefix);
                        });
                        return item ? (item.result ?? item.value ?? item) : null;
                    }
                    if (callsResult && typeof callsResult === 'object') {
                        const callKey = Object.keys(callsResult).find((k) => typeof k === 'string' && k.startsWith(prefix));
                        if (!callKey) return null;
                        const val = callsResult[callKey];
                        return val?.result ?? val?.value ?? val;
                    }
                    return null;
                };

                const loadPixelsViaPages = async () => {
                    try {
                        let totalUnique = null;
                        try {
                            const countState = await callNanoContractState({ calls: ['get_pixels_count()'] });
                            const rawCount = extractCallValue(countState?.calls || {}, 'get_pixels_count');
                            const countVal = unwrapValue(rawCount?.result ?? rawCount?.value ?? rawCount);
                            const countNum = Number(Array.isArray(countVal) ? countVal[0] : countVal);
                            if (Number.isFinite(countNum) && countNum >= 0) {
                                totalUnique = countNum;
                            }
                        } catch {
                            // optional; method may not exist on older contracts
                        }

                        const entries = new Map();

                        const collectPagesByOffset = (callsResult, requestedCalls = []) => {
                            const byOffset = new Map();
                            const push = (callKey, rawVal) => {
                                if (typeof callKey !== 'string') return;
                                const m = callKey.match(/get_pixels_page\((\d+)\s*,\s*(\d+)\)/);
                                if (!m) return;
                                const off = parseInt(m[1], 10);
                                byOffset.set(off, rawVal);
                            };
                            if (Array.isArray(callsResult)) {
                                callsResult.forEach((item, idx) => {
                                    const callKey = item?.call || item?.method || item?.name || '';
                                    const rawVal = item?.result ?? item?.value ?? item;
                                    if (callKey) {
                                        push(callKey, rawVal);
                                    } else if (requestedCalls[idx]) {
                                        push(requestedCalls[idx], rawVal);
                                    }
                                });
                                return byOffset;
                            }
                            if (callsResult && typeof callsResult === 'object') {
                                Object.entries(callsResult).forEach(([callKey, resultObj]) => {
                                    const rawVal = resultObj?.result ?? resultObj?.value ?? resultObj;
                                    push(callKey, rawVal);
                                });
                            }
                            return byOffset;
                        };

                        let pageIndex = 0;
                        let done = false;
                        while (!done && pageIndex < PIXELS_PAGE_MAX_PAGES) {
                            const baseOffset = pageIndex * PIXELS_PAGE_SIZE;
                            if (totalUnique !== null && baseOffset >= totalUnique) break;

                            const calls = [];
                            for (let i = 0; i < PIXELS_PAGE_CALLS_PER_REQUEST; i += 1) {
                                const offset = (pageIndex + i) * PIXELS_PAGE_SIZE;
                                if (totalUnique !== null && offset >= totalUnique) break;
                                calls.push(`get_pixels_page(${offset},${PIXELS_PAGE_SIZE})`);
                            }
                            if (!calls.length) break;

                            setTxStatus(`Loading painted pixels${totalUnique !== null ? ` (${Math.min(entries.size, totalUnique)}/${totalUnique})` : ''}...`);

                            const pageState = await callNanoContractState({ calls });
                            const pagesByOffset = collectPagesByOffset(pageState?.calls || {}, calls);

                            for (let i = 0; i < calls.length; i += 1) {
                                const offset = (pageIndex + i) * PIXELS_PAGE_SIZE;
                                const rawPage = pagesByOffset.get(offset);
                                const pageMap = parsePixelsField(rawPage);
                                if (!pageMap.size) {
                                    done = true;
                                    break;
                                }
                                pageMap.forEach((color, key) => entries.set(key, color));
                                if (pageMap.size < PIXELS_PAGE_SIZE) {
                                    done = true;
                                    break;
                                }
                            }

                            pageIndex += calls.length;

                            if (totalUnique !== null && totalUnique > 0) {
                                setLoadingProgress(Math.min(100, Math.round((entries.size / totalUnique) * 100)));
                            }
                        }

                        if (entries.size > 0 || totalUnique === 0) {
                            return { entries, totalUnique };
                        }
                        return null;
                    } catch (err) {
                        console.warn('Paged pixel load failed (missing view method?)', err);
                        return null;
                    }
                };

                const paged = await loadPixelsViaPages();
                if (paged) {
                    setChainPixels(paged.entries);
                    if (paged.entries.size > 0) {
                        setTxStatus(`Loaded ${paged.entries.size} pixels. Size: ${currentSize}.`);
                    } else {
                        setTxStatus(`Canvas loaded. Board is empty (0 pixels). Size: ${currentSize}.`);
                    }
                    return;
                }

                setTxStatus('Pixel snapshot unavailable. Expose pixels via state fields (fields[]=pixels), upgrade contract with get_pixels_page/get_pixels_count, or enable an indexer.');
                setChainPixels(new Map());
                return;

            } else {
                setTxStatus(`Canvas loaded. Board is empty (0 paints). Size: ${currentSize}.`);
                setChainPixels(new Map());
            }

        } catch (error) {
            console.error('State API load failed:', error);
            setTxStatus(error?.message || 'Failed to load canvas.');
        } finally {
            setLoading(false);
            setLoadingPixels([]);
            setLoadingProgress(0);
        }
    }, [callNanoContractState, applyStats, setLoadingPixels, walletId, canvasSize, indexerSnapshotUrl, loadContractMetaOnly]);

    // Set initial canvas position on mount
    useEffect(() => {
        // Small delay to ensure canvas is properly initialized
        const timer = setTimeout(() => {
            setOffset({ x: 50, y: 50 });
        }, 100);

        return () => clearTimeout(timer);
    }, []); // Empty dependency array - runs only once on mount

    // Loading animation loop
    useEffect(() => {
        if (!loading) return;

        const canvas = canvasRef.current;
        if (canvas) {
            setLoadingPixels(generateLoadingPixels(canvas.width, canvas.height));
        }

        let animationFrame;
        const animate = () => {
            if (loading) {
                draw();
                animationFrame = requestAnimationFrame(animate);
            }
        };
        animate();

        return () => {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
            }
        };
    }, [loading, draw, generateLoadingPixels, setLoadingPixels]);

    // Track Ctrl key state
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.ctrlKey || e.metaKey) {
                setCtrlPressed(true);
            }
        };

        const handleKeyUp = (e) => {
            if (!e.ctrlKey && !e.metaKey) {
                setCtrlPressed(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', () => setCtrlPressed(false));

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', () => setCtrlPressed(false));
        };
    }, []);

    // Redraw when state changes
    useEffect(() => {
        draw();
    }, [draw]);

    // Mouse handlers
    const getPixelCoords = (e) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const pixelX = Math.floor((x - offset.x) / pixelSize);
        const pixelY = Math.floor((y - offset.y) / pixelSize);

        if (pixelX >= 0 && pixelX < canvasSize && pixelY >= 0 && pixelY < canvasSize) {
            return { x: pixelX, y: pixelY };
        }
        return null;
    };

    const handleMouseMove = (e) => {
        const coords = getPixelCoords(e);
        setHoveredPixel(coords);

        if (isPanning) {
            const deltaX = e.clientX - lastMousePos.x;
            const deltaY = e.clientY - lastMousePos.y;

            setOffset(prev => {
                const canvas = canvasRef.current;
                if (!canvas) return prev;

                const canvasWidth = canvas.width;
                const canvasHeight = canvas.height;
                const actualCanvasSize = canvasSize * pixelSize;

                // Calculate new offset
                let newX = prev.x + deltaX;
                let newY = prev.y + deltaY;

                // Apply boundary constraints
                // Keep the canvas accessible - ensure (0,0) can always be reached
                const margin = 50; // Minimum margin from screen edges
                const maxX = canvasWidth - margin; // Don't let left edge go too far right
                const minX = margin - actualCanvasSize; // Don't let right edge go too far left
                const maxY = canvasHeight - margin; // Don't let top edge go too far down  
                const minY = margin - actualCanvasSize; // Don't let bottom edge go too far up

                newX = Math.max(minX, Math.min(maxX, newX));
                newY = Math.max(minY, Math.min(maxY, newY));

                return { x: newX, y: newY };
            });

            setLastMousePos({ x: e.clientX, y: e.clientY });

            // Check if mouse has moved enough to be considered a drag
            if (mouseDownPos && !hasDragged) {
                const distance = Math.sqrt(
                    Math.pow(e.clientX - mouseDownPos.x, 2) +
                    Math.pow(e.clientY - mouseDownPos.y, 2)
                );
                if (distance > 5) { // 5 pixel threshold
                    setHasDragged(true);
                }
            }
        }
    };

    const handleMouseDown = (e) => {
        // Store mouse down position for drag detection
        setMouseDownPos({ x: e.clientX, y: e.clientY });
        setHasDragged(false);

        if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
            setIsPanning(true);
            setLastMousePos({ x: e.clientX, y: e.clientY });
            e.preventDefault();
        }
    };

    const handleMouseUp = () => {
        setIsPanning(false);
        setMouseDownPos(null);
    };

    const handleClick = (e) => {
        // Only queue paint if left click without Ctrl key and not dragging
        if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && !hasDragged) {
            const coords = getPixelCoords(e);
            if (coords) {
                queuePaint(coords.x, coords.y);
            }
        }
    };

    const handleWheel = (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setZoom(prev => {
                const newZoom = Math.max(0.1, Math.min(4, prev * delta));

                // Apply boundary constraints when zoom changes
                requestAnimationFrame(() => {
                    const canvas = canvasRef.current;
                    if (canvas) {
                        setOffset(currentOffset => {
                            const canvasWidth = canvas.width;
                            const canvasHeight = canvas.height;
                            const actualCanvasSize = canvasSize * (DEFAULT_PIXEL_SIZE * newZoom);

                            const margin = 50;
                            const maxX = canvasWidth - margin;
                            const minX = margin - actualCanvasSize;
                            const maxY = canvasHeight - margin;
                            const minY = margin - actualCanvasSize;

                            const constrainedX = Math.max(minX, Math.min(maxX, currentOffset.x));
                            const constrainedY = Math.max(minY, Math.min(maxY, currentOffset.y));

                            return { x: constrainedX, y: constrainedY };
                        });
                    }
                });

                return newZoom;
            });
        }
    };

    // Zoom controls
    const handleZoomIn = () => {
        setZoom(prev => {
            const newZoom = Math.min(prev * 1.5, 4);
            applyBoundaryConstraints(newZoom);
            return newZoom;
        });
    };

    const handleZoomOut = () => {
        setZoom(prev => {
            const newZoom = Math.max(prev / 1.5, 0.1);
            applyBoundaryConstraints(newZoom);
            return newZoom;
        });
    };

    const applyBoundaryConstraints = (zoomLevel) => {
        requestAnimationFrame(() => {
            const canvas = canvasRef.current;
            if (canvas) {
                setOffset(currentOffset => {
                    const canvasWidth = canvas.width;
                    const canvasHeight = canvas.height;
                    const actualCanvasSize = canvasSize * (DEFAULT_PIXEL_SIZE * zoomLevel);

                    const margin = 50;
                    const maxX = canvasWidth - margin;
                    const minX = margin - actualCanvasSize;
                    const maxY = canvasHeight - margin;
                    const minY = margin - actualCanvasSize;

                    const constrainedX = Math.max(minX, Math.min(maxX, currentOffset.x));
                    const constrainedY = Math.max(minY, Math.min(maxY, currentOffset.y));

                    return { x: constrainedX, y: constrainedY };
                });
            }
        });
    };
    const handleResetView = () => {
        setZoom(1);
        // Position canvas so (0,0) is at top-left with small margin
        setOffset({ x: 50, y: 50 });
    };



    const ensureConnected = useCallback(async () => {
        try {
            let activeSession = session;
            if (!activeSession) {
                activeSession = await establishSession();
            }
            if (!activeSession) {
                setTxStatus('WalletConnect: session not established.');
                return false;
            }
            let address = storeWalletAddress || getAccountFromSession(activeSession)?.address || null;
            if (!address) {
                try {
                    address = await hathorRpc.requestAddress();
                } catch (requestErr) {
                    console.error('Wallet address request failed', requestErr);
                }
            }
            if (address) {
                setStoreWalletAddress(address);
                setTxStatus('');
                return true;
            }
            setTxStatus('WalletConnect: no address returned.');
            return false;
        } catch (err) {
            console.error('Wallet connection failed', err);
            setTxStatus('Wallet connection failed. Check WalletConnect setup.');
            return false;
        }
    }, [session, establishSession, storeWalletAddress, setStoreWalletAddress, hathorRpc]);

    const publishPendingPaints = useCallback(async (paints, txId, senderAddress) => {
        if (!liveFeedPostUrl) return;
        try {
            const headers = { 'content-type': 'application/json' };
            if (liveFeedSecret) {
                headers['x-live-feed-secret'] = liveFeedSecret;
            }
            await fetch(liveFeedPostUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    contract: contractId,
                    txId: txId || null,
                    sender: senderAddress || null,
                    paints: (paints || []).map((paint) => ({
                        x: paint.x,
                        y: paint.y,
                        color: String(paint.color || '').toLowerCase(),
                    })),
                }),
            });
        } catch (err) {
            console.warn('Live feed publish failed', err);
        }
    }, [liveFeedPostUrl, contractId, liveFeedSecret]);

    // Load canvas data on initial mount
    useEffect(() => {
        const timer = setTimeout(() => {
            loadCanvasViaWalletApi();
        }, 200); // Small delay after canvas position is set

        return () => clearTimeout(timer);
    }, [loadCanvasViaWalletApi, walletId]);

    const waitForTransactionConfirmationBatch = useCallback(async (paints, txId) => {
        const expected = new Map((paints || []).map(({ x, y, color }) => [`${x}:${y}`, String(color || '').toLowerCase()]));
        if (expected.size === 0) return false;

        const maxRetries = 10;
        let delay = 2000; // Start with 2 seconds

        const checkResult = (callKey, val, confirmed) => {
            const argsMatch = typeof callKey === 'string' ? callKey.match(/\((\d+),\s*(\d+)\)/) : null;
            if (!argsMatch) return;
            const x = parseInt(argsMatch[1], 10);
            const y = parseInt(argsMatch[2], 10);
            const key = `${x}:${y}`;
            const expectedColor = expected.get(key);
            if (!expectedColor) return;
            const colorVal = Array.isArray(val) && val.length >= 1 ? val[0] : null;
            if (typeof colorVal === 'string' && colorVal.toLowerCase() === expectedColor) {
                confirmed.add(key);
            }
        };

        for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
            try {
                setTxStatus(`Waiting for confirmation... (${retryCount + 1}/${maxRetries})${txId ? ` ${txId}` : ''}`);

                await new Promise(resolve => setTimeout(resolve, delay));

                const calls = paints.map(({ x, y }) => `get_pixel_info(${x},${y})`);
                const state = await callNanoContractState({ calls });
                const results = state?.calls || {};
                const confirmed = new Set();

                if (Array.isArray(results)) {
                    results.forEach(item => {
                        const callKey = item?.call || item?.method || '';
                        const val = item?.result ?? item?.value ?? item;
                        checkResult(callKey, val, confirmed);
                    });
                } else {
                    Object.entries(results).forEach(([callKey, resultObj]) => {
                        const val = resultObj?.result ?? resultObj?.value ?? resultObj;
                        checkResult(callKey, val, confirmed);
                    });
                }

                if (confirmed.size === expected.size) {
                    setChainPixels(prev => {
                        const next = new Map(prev);
                        expected.forEach((color, key) => next.set(key, color));
                        return next;
                    });
                    setPendingPaints(prev => {
                        const next = new Map(prev);
                        expected.forEach((_, key) => next.delete(key));
                        return next;
                    });
                    setQueuedPaints(prev => {
                        const next = new Map(prev);
                        expected.forEach((_, key) => next.delete(key));
                        return next;
                    });
                    setTxStatus('Batch confirmed on-chain.');
                    return true;
                }
            } catch (error) {
                console.error('Error checking transaction confirmation:', error);
            }

            delay = Math.min(delay * 1.5, 8000);
        }

        setTxStatus('Batch submitted; still syncing. Try reload if pixels do not appear.');
        return false;
    }, [callNanoContractState]);

    // Initialize color and wallet id from localStorage after component mounts
    // Also load persisted pending transactions
    useEffect(() => {
        setIsMounted(true);
        const savedColor = typeof localStorage !== 'undefined' ? localStorage.getItem('pixel-color') : null;
        if (savedColor) {
            setSelected(savedColor);
        }
        const savedWalletId = typeof localStorage !== 'undefined' ? localStorage.getItem('wallet-id') : null;
        if (savedWalletId && !storeWalletId) {
            setStoreWalletId(savedWalletId);
        }

        // Load pending transactions from localStorage and restore them as pending paints
        const storedPendingTx = loadPendingTxFromStorage();
        const validPendingTx = cleanExpiredPendingTx(storedPendingTx);

        // If some expired, update storage
        if (validPendingTx.length !== storedPendingTx.length) {
            savePendingTxToStorage(validPendingTx);
        }

        // Merge pending paints into state
        if (validPendingTx.length > 0) {
            const restoredPaints = new Map();
            validPendingTx.forEach(tx => {
                if (Array.isArray(tx.paints)) {
                    tx.paints.forEach(paint => {
                        const key = `${paint.x}:${paint.y}`;
                        restoredPaints.set(key, String(paint.color || '').toLowerCase());
                    });
                }
            });
            if (restoredPaints.size > 0) {
                setPendingPaints(prev => {
                    const next = new Map(prev);
                    restoredPaints.forEach((color, key) => next.set(key, color));
                    return next;
                });
                setTxStatus(`Restored ${restoredPaints.size} pending pixel(s) from previous session.`);
            }
        }
    }, [setStoreWalletId, storeWalletId]);


    // Save selected color and wallet id to localStorage whenever they change (only after mount)
    useEffect(() => {
        if (isMounted) {
            try { localStorage.setItem('pixel-color', selected); } catch { }
            try { if (walletId) localStorage.setItem('wallet-id', walletId); } catch { }
        }
    }, [selected, walletId, isMounted]);

    const queuePaint = useCallback((x, y) => {
        if (!isWalletConnected) {
            setTxStatus('Connect your wallet to paint.');
            return;
        }
        const color = (selected || '#ffffff').toLowerCase();
        if (isCommitting) {
            setTxStatus('Batch in flight; wait before adding more.');
            return;
        }
        let rejected = false;
        let nextSize = queuedCount;
        setQueuedPaints(prev => {
            if (!prev.has(`${x}:${y}`) && prev.size >= MAX_BATCH_SIZE) {
                rejected = true;
                return prev;
            }
            const next = new Map(prev);
            next.set(`${x}:${y}`, { x, y, color });
            nextSize = next.size;
            return next;
        });
        if (rejected) {
            setTxStatus(`Batch limit of ${MAX_BATCH_SIZE} pixels reached.`);
            return;
        }

        // Off-chain "draft" broadcast so other clients can see queued paints before commit.
        publishPendingPaints([{ x, y, color }], null, connectedAddress);

        const totalFee = nextSize * perPixelFee;
        setTxStatus(`Queued ${nextSize} pixel${nextSize > 1 ? 's' : ''}. Total fee: ${totalFee} ${depositToken === '00' ? 'HTR' : depositToken}.`);
    }, [isWalletConnected, selected, isCommitting, queuedCount, perPixelFee, depositToken, publishPendingPaints, connectedAddress]);

    const handleCommitBatch = useCallback(async () => {
        if (isCommitting) return;
        if (!isWalletConnected) {
            setTxStatus('Connect your wallet to commit a batch.');
            return;
        }
        if (!queuedPaints.size) {
            setTxStatus('Queue at least one pixel before committing.');
            return;
        }
        const paints = Array.from(queuedPaints.values());
        if (!blueprintId) {
            setTxStatus('Blueprint ID is missing. Configure NEXT_PUBLIC_BLUEPRINT_ID.');
            return;
        }
        if (!contractId) {
            setTxStatus('Contract ID is missing. Configure NEXT_PUBLIC_CANVAS_CONTRACT.');
            return;
        }

        const isConnected = await ensureConnected();
        if (!isConnected) {
            return;
        }

        const totalFee = perPixelFee * paints.length;
        const address = connectedAddress;
        if (!address) {
            setTxStatus('Wallet address unavailable.');
            return;
        }

        setIsCommitting(true);
        try {
            const xs = paints.map(p => p.x);
            const ys = paints.map(p => p.y);
            const colors = paints.map(p => p.color.toLowerCase());

            const actions = [];
            if (totalFee && totalFee > 0) {
                actions.push({
                    type: 'deposit',
                    token: depositToken,
                    amount: String(totalFee),
                    address,
                    changeAddress: address,
                });
            }

            const rpcRequest = sendNanoContractTxRpcRequest(
                'paint_batch',
                blueprintId,
                actions,
                [xs, ys, colors],
                true,
                contractId || null,
            );

            const tx = await hathorRpc.sendNanoContractTx(rpcRequest);
            if (tx && tx.errors && tx.errors.length) {
                throw new Error(tx.errors.join(', '));
            }

            const txId = tx?.hash || tx?.txId || tx?.transaction || null;

            // Save pending transaction to localStorage IMMEDIATELY after wallet accepts
            // This ensures pixels persist across page reloads even before indexer confirms
            const pendingTxEntry = {
                txId: txId || `local-${Date.now()}`,
                paints: paints.map(p => ({ x: p.x, y: p.y, color: p.color.toLowerCase() })),
                sender: address,
                timestamp: Date.now(),
            };
            const existingPendingTx = loadPendingTxFromStorage();
            const updatedPendingTx = [...cleanExpiredPendingTx(existingPendingTx), pendingTxEntry];
            savePendingTxToStorage(updatedPendingTx);

            // Also add to pendingPaints state for immediate visual feedback
            setPendingPaints(prev => {
                const next = new Map(prev);
                paints.forEach(p => {
                    const key = `${p.x}:${p.y}`;
                    next.set(key, p.color.toLowerCase());
                });
                return next;
            });

            await publishPendingPaints(paints, txId, address);
            setTxStatus(`Batch submitted (${paints.length} pixels${txId ? `, ${txId}` : ''}). Waiting for confirmation...`);

            const confirmed = await waitForTransactionConfirmationBatch(paints, txId);
            if (confirmed) {
                setQueuedPaints(new Map());

                // Remove this transaction from localStorage pending list
                const currentPendingTx = loadPendingTxFromStorage();
                const cleanedPendingTx = currentPendingTx.filter(tx => tx.txId !== pendingTxEntry.txId);
                savePendingTxToStorage(cleanedPendingTx);
            }
        } catch (e) {
            console.error('Transaction error raw:', e);
            let errorMessage = 'Transaction error.';

            if (e && typeof e === 'object') {
                errorMessage = e.message || e.reason || e.description || (e.error && e.error.message) || errorMessage;

                if (Object.keys(e).length === 0 && !e.message) {
                    console.warn('Empty error object detected. Checking prototype or hidden fields...');
                    const detailed = JSON.stringify(e, Object.getOwnPropertyNames(e));
                    if (detailed !== '{}') {
                        errorMessage = `Error details: ${detailed}`;
                    } else {
                        errorMessage = `Unknown error (empty object). Type: ${e.constructor.name}`;
                    }
                }
            } else if (typeof e === 'string') {
                errorMessage = e;
            }

            console.error('Final Error Message for UI:', errorMessage);
            setTxStatus(errorMessage);
        } finally {
            setIsCommitting(false);
        }
    }, [isCommitting, isWalletConnected, queuedPaints, blueprintId, ensureConnected, perPixelFee, connectedAddress, depositToken, contractId, hathorRpc, waitForTransactionConfirmationBatch, publishPendingPaints]);


    const handleWithdrawFees = useCallback(async () => {
        if (isWithdrawing) return;
        if (!isWalletConnected) {
            setTxStatus('Connect your wallet to withdraw fees.');
            return;
        }
        if (!isOwner) {
            setTxStatus('Only the contract owner can withdraw fees.');
            return;
        }
        if (!blueprintId) {
            setTxStatus('Blueprint ID is missing. Configure NEXT_PUBLIC_BLUEPRINT_ID.');
            return;
        }
        if (!contractId) {
            setTxStatus('Contract ID is missing. Configure NEXT_PUBLIC_CANVAS_CONTRACT.');
            return;
        }

        const isConnected = await ensureConnected();
        if (!isConnected) {
            return;
        }

        const address = connectedAddress;
        if (!address) {
            setTxStatus('Wallet address unavailable.');
            return;
        }

        const amount = Number(feesCollected);
        if (!Number.isFinite(amount) || amount <= 0) {
            setTxStatus('No fees to withdraw.');
            return;
        }

        setIsWithdrawing(true);
        try {
            const actions = [{
                type: 'withdrawal',
                token: '00',
                amount: String(amount),
                address,
            }];

            const rpcRequest = sendNanoContractTxRpcRequest(
                'withdraw_fees',
                blueprintId,
                actions,
                [],
                true,
                contractId || null,
            );

            const tx = await hathorRpc.sendNanoContractTx(rpcRequest);
            if (tx && tx.errors && tx.errors.length) {
                throw new Error(tx.errors.join(', '));
            }

            const txId = tx?.hash || tx?.txId || tx?.transaction || null;
            setTxStatus(`Withdraw submitted${txId ? ` (${txId})` : ''}. Waiting for confirmation...`);

            setTimeout(() => {
                loadContractMetaOnly();
            }, 2500);
        } catch (e) {
            console.error('Withdraw error raw:', e);
            let errorMessage = 'Withdraw error.';

            if (e && typeof e === 'object') {
                errorMessage = e.message || e.reason || e.description || (e.error && e.error.message) || errorMessage;

                if (Object.keys(e).length === 0 && !e.message) {
                    console.warn('Empty error object detected. Checking prototype or hidden fields...');
                    const detailed = JSON.stringify(e, Object.getOwnPropertyNames(e));
                    if (detailed !== '{}') {
                        errorMessage = `Error details: ${detailed}`;
                    } else {
                        errorMessage = `Unknown error (empty object). Type: ${e.constructor.name}`;
                    }
                }
            } else if (typeof e === 'string') {
                errorMessage = e;
            }

            console.error('Final Error Message for UI:', errorMessage);
            setTxStatus(errorMessage);
        } finally {
            setIsWithdrawing(false);
        }
    }, [isWithdrawing, isWalletConnected, isOwner, blueprintId, contractId, ensureConnected, connectedAddress, feesCollected, hathorRpc, loadContractMetaOnly]);

    const handleClearQueue = useCallback(() => {
        setQueuedPaints(new Map());
        setTxStatus('Cleared queued paints.');
    }, []);

    return (
        <section className="section fullscreen">
            <canvas
                ref={canvasRef}
                className="pixel-canvas"
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onClick={handleClick}
                onWheel={handleWheel}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                    cursor: isPanning ? 'grabbing' : (ctrlPressed ? 'grab' : 'crosshair')
                }}
            />

            <div className="brand-mini pixel-frame">
                <a href="/" className="brand-mini-link">
                    <span className="brand-mini-text">p<span className="x-accent">X</span>iel</span>
                </a>
            </div>

            <div className={`floating-controls pixel-frame ${showControls ? '' : 'hidden'}`}>
                <button
                    className="toggle-controls"
                    onClick={() => setShowControls(!showControls)}
                >
                    {showControls ? '◀' : '▶'}
                </button>

                <div className="controls-content">
                    <div className="control-group">
                        <label className="label">Color</label>
                        <div className="color-picker-container">
                            <input
                                className="color"
                                type="color"
                                value={selected}
                                onChange={e => setSelected(e.target.value)}
                            />
                            <div className="color-preview">
                                <div className="color-swatch" style={{ backgroundColor: selected }}></div>
                                <span className="color-text">{selected.toUpperCase()}</span>
                            </div>
                        </div>
                    </div>

                    <div className="control-group">
                        <label className="label">Zoom</label>
                        <span className="pill">{Math.round(zoom * 100)}%</span>
                        <button className="btn btn-zoom" onClick={handleZoomOut}>−</button>
                        <button className="btn btn-zoom" onClick={handleZoomIn}>+</button>

                    </div>

                    <div className="control-group">
                        <button className="btn" onClick={loadCanvasViaWalletApi} disabled={loading}>
                            {loading ? 'Loading...' : 'Reload'}
                        </button>
                    </div>

                    <div className="control-group">
                        <span className="pill">Queued: {queuedCount}/{MAX_BATCH_SIZE}</span>
                        <span className="pill">Batch fee: {batchTotalFee} {depositToken === '00' ? 'HTR' : depositToken}</span>
                        <button className="btn" onClick={handleCommitBatch} disabled={!queuedCount || isCommitting || !isWalletConnected}>
                            {isCommitting ? 'Submitting...' : 'Commit batch'}
                        </button>
                        <button className="btn btn-secondary" onClick={handleClearQueue} disabled={!queuedCount || isCommitting}>
                            Clear
                        </button>
                    </div>

                    <div className="control-group">
                        <span className="pill">Size: {canvasSize}</span>
                        <span className="pill">Painted: {paintCount}</span>
                        <span className="pill">Fee: {feeAmount || depositAmount} {depositToken === '00' ? 'HTR' : depositToken}</span>
                        <span className="pill">Fees: {feesCollected} HTR</span>
                    </div>

                    {isOwner && (
                        <div className="control-group">
                            <span className="pill">Owner</span>
                            <button className="btn btn-secondary" onClick={handleWithdrawFees} disabled={isWithdrawing || feesCollected <= 0}>
                                {isWithdrawing ? 'Withdrawing...' : 'Withdraw fees'}
                            </button>
                        </div>
                    )}

                    {hoveredPixel && (
                        <div className="control-group">
                            <span className="pill">Pixel: ({hoveredPixel.x}, {hoveredPixel.y})</span>
                        </div>
                    )}

                    {realtimeStatus && (
                        <div className="control-group">
                            <div className="status-mini">{realtimeStatus}</div>
                        </div>
                    )}

                    {txStatus && (
                        <div className="control-group">
                            <div className="status-mini">{txStatus}</div>
                        </div>
                    )}
                </div>
            </div>

            <div className="controls-hint-mini">
                <p>
                    {ctrlPressed ? (
                        <><span style={{ color: 'var(--text-primary)' }}>◆ Pan/Zoom Mode</span> | Release <kbd>Ctrl/Cmd</kbd> to paint</>
                    ) : (
                        <><kbd>Ctrl/Cmd+Scroll</kbd> Zoom | <kbd>Ctrl/Cmd+Drag</kbd> Pan | <kbd>Click</kbd> Queue | <kbd>Commit batch</kbd> to send</>
                    )}
                </p>
            </div>
        </section>
    );
}
