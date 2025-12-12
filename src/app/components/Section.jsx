'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CONTRACT_NAME,
    DEFAULT_SIZE,
    DEPOSIT_AMOUNT,
    DEPOSIT_TOKEN,
    PIXEL_PRICE_WEI,
    WALLET_ADDRESS,
    WALLET_API_BASE,
    WALLET_ID,
} from '@/app/lib/addresses';
import { usePixelLoadingAnimation } from './PixelLoadingAnimation';
import useStore from '@/app/lib/store';
import WalletUtilService from '@/app/lib/wallet-util-service.mjs';

const DEFAULT_PIXEL_SIZE = 10;
const DEFAULT_CANVAS_SIZE = Number(process.env.NEXT_PUBLIC_CANVAS_SIZE || DEFAULT_SIZE || 32);

const getErrorMessage = (error) => {
    if (!error) return 'An unknown error occurred.';
    if (typeof error === 'string') return error;

    // Standard Error object, preferring original error message if available
    if (error.message) {
        const originalMsg = error.originalError?.message || error.originalError?.reason;
        if (originalMsg && typeof originalMsg === 'string' && originalMsg.length > 5) {
            return originalMsg;
        }
        return error.message;
    }

    // For WalletConnect or other complex objects
    if (typeof error === 'object') {
        if (error.reason) return error.reason;
        if (error.error?.message) return error.error.message;
        try {
            const json = JSON.stringify(error, Object.getOwnPropertyNames(error));
            if (json !== '{}' && json !== '[]') {
                return `Transaction failed with details: ${json}`;
            }
        } catch { /* ignore serialization errors */ }
    }

    return 'An unknown transaction error occurred. Please check the console for details.';
};

export default function Section() {
    const canvasRef = useRef(null);
    const storeWalletId = useStore(state => state.walletId);
    const storeWalletAddress = useStore(state => state.walletAddress);
    const setStoreWalletId = useStore(state => state.setWalletId);
    const setStoreWalletAddress = useStore(state => state.setWalletAddress);
    const [pixels, setPixels] = useState(new Map());
    const [selected, setSelected] = useState('#ffffff');
    const [isMounted, setIsMounted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const { loadingPixels, setLoadingPixels, generateLoadingPixels, drawLoadingAnimation } = usePixelLoadingAnimation();
    const [txStatus, setTxStatus] = useState('');
    const [canvasSize, setCanvasSize] = useState(DEFAULT_CANVAS_SIZE);
    const [paintCount, setPaintCount] = useState(0);
    const [feeAmount, setFeeAmount] = useState(Number(DEPOSIT_AMOUNT || PIXEL_PRICE_WEI || 0));
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 50, y: 50 }); // Start with (0,0) at top-left with small margin
    const [isPanning, setIsPanning] = useState(false);
    const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
    const [hoveredPixel, setHoveredPixel] = useState(null);
    const [showControls, setShowControls] = useState(true);
    const [ctrlPressed, setCtrlPressed] = useState(false);
    const [mouseDownPos, setMouseDownPos] = useState(null);
    const [hasDragged, setHasDragged] = useState(false);
    const walletApiBase = useMemo(() => (WALLET_API_BASE || '').replace(/\/$/, ''), []);
    const walletId = storeWalletId || WALLET_ID || 'alice';
    const senderAddress = storeWalletAddress || WALLET_ADDRESS;
    const depositToken = DEPOSIT_TOKEN || '00';
    const depositAmount = Number(DEPOSIT_AMOUNT || PIXEL_PRICE_WEI || 100);
    const contractId = CONTRACT_NAME;

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

        // Soft vignette/glow to match pink/white palette
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

        // Draw grid background with subtle lines (white/pink theme)
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

        // Draw pixels
        pixels.forEach((color, key) => {
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
    }, [pixels, offset, zoom, pixelSize, hoveredPixel, loading, loadingProgress, loadingPixels, drawLoadingAnimation, canvasSize]);

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

        // Use Next.js API proxy to avoid CORS issues with localhost node
        const nodeApiProxy = '/api/node';

        const params = new URLSearchParams();
        params.set('id', contractId);
        for (const call of calls) {
            params.append('calls[]', call);
        }
        for (const field of fields) {
            params.append('fields[]', field);
        }
        const url = `${nodeApiProxy}/nano_contract/state?${params.toString()}`;

        let res;
        let text = '';
        let json = {};
        try {
            res = await fetch(url);
            text = await res.text();
            json = JSON.parse(text);
        } catch (e) {
            console.error('Failed to parse response:', e);
        }

        if (!res || !res.ok) {
            const msg = json?.error || json?.message || text || `Error getting nano contract state (${res?.status || 'n/a'})`;
            console.error('callNanoContractState failed', { url, status: res?.status, msg, body: text });
            throw new Error(msg);
        }

        // Node API returns fields/calls directly (not wrapped in "state")
        return json || {};
    }, [contractId]);

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
    }, []);

    const loadCanvasViaWalletApi = useCallback(async () => {
        if (!walletId) {
            setTxStatus('Set Wallet ID (X-Wallet-Id) to load the canvas.');
            return;
        }
        setLoading(true);
        setLoadingProgress(0);
        setLoadingPixels([]);

        try {
            // First pass: Get stats to know the board size
            const statsState = await callNanoContractState({
                fields: ['paint_count', 'fees_collected', 'size', 'fee_htr'],
                calls: ['get_stats()']
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

            const currentSize = Number(statsVal.size) || canvasSize || 10;
            const pCount = Number(statsVal.paint_count || 0);

            // Second pass: Scan all pixels if we have paints
            if (pCount > 0) {
                setTxStatus(`Scanning ${currentSize}x${currentSize} board for ${pCount} paints...`);

                const pixelCalls = [];
                for (let x = 0; x < currentSize; x++) {
                    for (let y = 0; y < currentSize; y++) {
                        pixelCalls.push(`get_pixel_info(${x},${y})`);
                    }
                }

                // Call in batches if needed, but 100 calls is likely fine for one request
                // The wallet service might have limits, but let's try one batch first
                const pixelsState = await callNanoContractState({
                    calls: pixelCalls
                });

                const pixelResults = pixelsState?.calls || {};
                const entries = new Map();
                let foundPixels = 0;

                // Handle both array and object response formats
                if (Array.isArray(pixelResults)) {
                    pixelResults.forEach(item => {
                        // Parse call string "get_pixel_info(x,y)" -> x, y
                        const callStr = item.call || item.method || '';
                        const match = callStr.match(/Get_pixel_info\((\d+),(\d+)\)/i);
                        // Note: Regex case insensitive just in case, though usually exact
                        // Actually better to parse the method name passed in

                        const val = item.result ?? item.value;
                        if (val && Array.isArray(val) && val.length >= 1) {
                            // Tuple: [color, address, timestamp]
                            const color = val[0];
                            // Extract coords from the executed call string if possible, 
                            // OR rely on order if we trusted it (risky).
                            // Robust way: extract from call string.
                            const argsMatch = callStr.match(/\((\d+),\s*(\d+)\)/);
                            if (argsMatch) {
                                const x = parseInt(argsMatch[1], 10);
                                const y = parseInt(argsMatch[2], 10);
                                entries.set(`${x}:${y}`, color);
                                foundPixels++;
                            }
                        }
                    });
                } else {
                    Object.entries(pixelResults).forEach(([callKey, resultObj]) => {
                        const val = resultObj?.result ?? resultObj?.value ?? resultObj;
                        if (val && Array.isArray(val) && val.length >= 1) {
                            const color = val[0];
                            const argsMatch = callKey.match(/\((\d+),\s*(\d+)\)/);
                            if (argsMatch) {
                                const x = parseInt(argsMatch[1], 10);
                                const y = parseInt(argsMatch[2], 10);
                                entries.set(`${x}:${y}`, color);
                                foundPixels++;
                            }
                        }
                    });
                }

                setPixels(entries);
                if (foundPixels > 0) {
                    setTxStatus(`Loaded ${foundPixels} pixels. Size: ${currentSize}.`);
                } else {
                    setTxStatus(`Scanned board. Found 0 active pixels (History: ${pCount} paints).`);
                }

            } else {
                setTxStatus(`Connected. Board is empty (0 paints). Size: ${currentSize}. Try painting!`);
                setPixels(new Map());
            }

        } catch (error) {
            console.error('Wallet API load failed:', error);
            setTxStatus(error?.message || 'Failed to load canvas.');
        } finally {
            setLoading(false);
            setLoadingPixels([]);
            setLoadingProgress(0);
        }
    }, [callNanoContractState, applyStats, setLoadingPixels, walletId, canvasSize]);

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

    const handleClick = async (e) => {
        // Only paint if left click without Ctrl key and not dragging
        if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && !hasDragged) {
            const coords = getPixelCoords(e);
            if (coords) {
                const connected = await ensureConnected();
                if (!connected) return;
                await handlePaint(coords.x, coords.y);
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
            const w = WalletUtilService.getInstance().HathorWalletUtils;
            await w.init(process.env.NEXT_PUBLIC_HATHOR_RPC || 'https://wallet-service.hathor.network');
            const info = await w.requestWalletInfo();
            const address = info?.address || info?.wallet?.address || null;
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
    }, [setStoreWalletAddress]);

    // Load canvas data on initial mount
    useEffect(() => {
        const timer = setTimeout(() => {
            loadCanvasViaWalletApi();
        }, 200); // Small delay after canvas position is set

        return () => clearTimeout(timer);
    }, [loadCanvasViaWalletApi, walletId]);

    const waitForTransactionConfirmation = useCallback(async (x, y, expectedColor) => {
        const maxRetries = 10;
        let retryCount = 0;
        let delay = 2000; // Start with 2 seconds

        while (retryCount < maxRetries) {
            try {
                setTxStatus(`Waiting for confirmation... (${retryCount + 1}/${maxRetries})`);

                await new Promise(resolve => setTimeout(resolve, delay));
                await loadCanvasViaWalletApi();

                // Optimistic update for current contract (no pixel storage yet)
                setPixels(prev => {
                    const next = new Map(prev);
                    next.set(`${x}:${y}`, expectedColor);
                    return next;
                });

                setTxStatus('Success! Pixel painted (optimistic, refreshed from chain).');
                return;
            } catch (error) {
                console.error('Error checking transaction confirmation:', error);
                retryCount++;
                if (retryCount < maxRetries) {
                    delay = Math.min(delay * 1.5, 8000);
                }
            }
        }

        setTxStatus('Transaction may still be processing. Canvas reloaded; check if your pixel appeared.');
    }, [loadCanvasViaWalletApi]);

    // Initialize color and wallet id from localStorage after component mounts
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
    }, [setStoreWalletId, storeWalletId]);

    // Save selected color and wallet id to localStorage whenever they change (only after mount)
    useEffect(() => {
        if (isMounted) {
            try { localStorage.setItem('pixel-color', selected); } catch { }
            try { if (walletId) localStorage.setItem('wallet-id', walletId); } catch { }
        }
    }, [selected, walletId, isMounted]);

    const handlePaint = useCallback(async (x, y) => {
        // Ensure wallet is connected
        if (!(await ensureConnected())) {
            return;
        }

        const color = selected.toLowerCase();
        setTxStatus(`Painting pixel at (${x}, ${y})...`);

        try {
            const amountToSend = Number.isFinite(feeAmount) && feeAmount > 0 ? feeAmount : depositAmount;

            // Log all paint parameters for debugging
            console.log('[DEBUG] Paint parameters:', {
                contractId,
                method: 'paint',
                args: [x, y, color],
                depositToken,
                depositAmount: amountToSend,
                feeAmount,
                rawDepositAmount: depositAmount,
            });

            // Use WalletConnect for transaction signing
            const w = WalletUtilService.getInstance().HathorWalletUtils;
            console.log('[DEBUG] WalletUtils chainId:', w.chainId);
            console.log('[DEBUG] WalletUtils session:', w.session ? 'exists' : 'null');

            const tx = await w.sendTransaction(
                contractId,
                'paint',
                [x, y, color],
                { depositToken, depositAmount: amountToSend }
            );

            if (tx && tx.errors && tx.errors.length) {
                throw new Error(tx.errors.join(', '));
            }

            const txId = tx?.hash || tx?.txId || tx?.transaction || null;
            setTxStatus(`Paint submitted${txId ? ` (${txId})` : ''}. Waiting for blockchain confirmation...`);

            await waitForTransactionConfirmation(x, y, color);

        } catch (e) {
            console.error('Transaction error raw:', e);
            const errorMessage = getErrorMessage(e);
            console.error('Final Error Message for UI:', errorMessage);
            setTxStatus(errorMessage);
        }
    }, [ensureConnected, contractId, depositAmount, depositToken, selected, waitForTransactionConfirmation, feeAmount]);

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
                        <span className="pill">Size: {canvasSize}</span>
                        <span className="pill">Painted: {paintCount}</span>
                        <span className="pill">Fee: {feeAmount || depositAmount} {depositToken === '00' ? 'HTR' : depositToken}</span>
                    </div>

                    {hoveredPixel && (
                        <div className="control-group">
                            <span className="pill">Pixel: ({hoveredPixel.x}, {hoveredPixel.y})</span>
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
                        <><kbd>Ctrl/Cmd+Scroll</kbd> Zoom | <kbd>Ctrl/Cmd+Drag</kbd> Pan | <kbd>Click</kbd> Paint</>
                    )}
                </p>
            </div>
        </section>
    );
}
