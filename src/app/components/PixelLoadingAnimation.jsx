'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';

const CANVAS_SIZE = 500;

// Pixel class for sophisticated animation
class LoadingPixel {
    constructor(canvas, context, x, y, color, speed, delay) {
        this.width = canvas.width;
        this.height = canvas.height;
        this.ctx = context;
        this.x = x;
        this.y = y;
        this.color = color;
        this.speed = this.getRandomValue(0.1, 0.9) * speed;
        this.size = 0;
        this.sizeStep = Math.random() * 0.4 + 0.1; // Ensure minimum growth rate
        this.minSize = 1;
        this.maxSizeInteger = 4;
        this.maxSize = this.getRandomValue(this.minSize, this.maxSizeInteger);
        this.delay = delay;
        this.counter = 0;
        this.counterStep = Math.random() * 4 + (this.width + this.height) * 0.01;
        this.isIdle = false;
        this.isReverse = false;
        this.isShimmer = false;
        this.isActive = true; // Always active for loading animation
    }

    getRandomValue(min, max) {
        return Math.random() * (max - min) + min;
    }

    draw() {
        const centerOffset = this.maxSizeInteger * 0.5 - this.size * 0.5;
        this.ctx.fillStyle = this.color;
        this.ctx.fillRect(this.x + centerOffset, this.y + centerOffset, this.size, this.size);
    }

    appear() {
        this.isIdle = false;
        if (this.counter <= this.delay) {
            this.counter += this.counterStep;
            return;
        }
        if (this.size >= this.maxSize) {
            this.isShimmer = true;
        }
        if (this.isShimmer) {
            this.shimmer();
        } else {
            this.size += this.sizeStep;
        }
        this.draw();
    }

    disappear() {
        this.isShimmer = false;
        this.counter = 0;
        if (this.size <= 0) {
            this.isIdle = true;
            return;
        } else {
            this.size -= 0.1;
        }
        this.draw();
    }

    shimmer() {
        if (this.size >= this.maxSize) {
            this.isReverse = true;
        } else if (this.size <= this.minSize) {
            this.isReverse = false;
        }
        if (this.isReverse) {
            this.size -= this.speed;
        } else {
            this.size += this.speed;
        }
    }
}

export default function PixelLoadingAnimation({
    isLoading,
    progress,
    offset,
    pixelSize,
    canvasWidth,
    canvasHeight
}) {
    const [backgroundPixels, setBackgroundPixels] = useState([]);
    const animationRef = useRef();
    const timeIntervalRef = useRef(1000 / 60);
    const timePreviousRef = useRef(performance.now());

    // Generate sophisticated background pixels
    useEffect(() => {
        if (!isLoading || !canvasWidth || !canvasHeight) return;

        // Match wordmark palette: white + pink
        const colors = ['#ffffff', '#e5e5e5', '#cfcfcf', '#a0a0a0', '#000000'];
        const gap = 12; // Larger gap for better visibility
        const speed = 0.05; // Slightly faster animation
        const pixels = [];

        for (let x = 0; x < canvasWidth; x += gap) {
            for (let y = 0; y < canvasHeight; y += gap) {
                const color = colors[Math.floor(Math.random() * colors.length)];
                const centerX = canvasWidth / 2;
                const centerY = canvasHeight / 2;
                const distance = Math.hypot(x - centerX, y - centerY);
                const delay = distance * 0.1; // Faster appearance

                pixels.push(new LoadingPixel(
                    { width: canvasWidth, height: canvasHeight },
                    null, // Will be set during draw
                    x, y, color, speed, delay
                ));
            }
        }

        setBackgroundPixels(pixels);
    }, [isLoading, canvasWidth, canvasHeight]);

    const drawLoadingAnimation = (ctx) => {
        if (!isLoading) return;

        // Dark background with gradient
        const gradient = ctx.createRadialGradient(
            canvasWidth * 0.7, -200, 0,
            canvasWidth * 0.7, -200, 1200
        );
        gradient.addColorStop(0, 'rgba(12, 12, 12, 0.8)');
        gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0)');

        const gradient2 = ctx.createRadialGradient(
            -200, canvasHeight * 0.8, 0,
            -200, canvasHeight * 0.8, 900
        );
        gradient2.addColorStop(0, 'rgba(18, 18, 18, 0.8)');
        gradient2.addColorStop(0.6, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        ctx.fillStyle = gradient2;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Update pixel contexts and animate background pixels
        const timeNow = performance.now();
        const timePassed = timeNow - timePreviousRef.current;

        if (timePassed >= timeIntervalRef.current) {
            timePreviousRef.current = timeNow - (timePassed % timeIntervalRef.current);

            // Animate background pixels
            backgroundPixels.forEach(pixel => {
                pixel.ctx = ctx;
                pixel.appear();
            });
        }

        // Center content (snap to integers for crisp pixels)
        const centerX = Math.round(canvasWidth / 2);
        const centerY = Math.round(canvasHeight / 2);

        // pXiel wordmark with pixel font (no rotation/skew, integer sizes)
        ctx.imageSmoothingEnabled = false;
        const baseSize = Math.min(canvasWidth * 0.12, 100);
        const snappedSize = Math.max(24, Math.round(baseSize / 8) * 8);
        ctx.font = `bold ${snappedSize}px 'Press Start 2P', ui-sans-serif, system-ui, -apple-system`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.filter = 'none';

        const widthFull = ctx.measureText('pXiel').width;
        const widthP = ctx.measureText('p').width;
        const widthPX = ctx.measureText('pX').width;
        const startX = Math.round(centerX - widthFull / 2);

        // p
        ctx.fillStyle = '#e3e3e3';
        ctx.fillText('p', startX, centerY);
        // X accent (white)
        ctx.fillStyle = '#ffffff';
        ctx.fillText('X', Math.round(startX + widthP), centerY);
        // iel
        ctx.fillStyle = '#e3e3e3';
        ctx.fillText('iel', Math.round(startX + widthPX), centerY);

        // Subtitle
        ctx.fillStyle = 'rgba(227, 227, 227, 0.7)';
        const subSize = Math.max(10, Math.round(Math.min(canvasWidth * 0.02, 16)));
        ctx.font = `${subSize}px 'Press Start 2P', ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText('loading canvas...', centerX, Math.round(centerY + snappedSize * 0.7));

        // Progress indicator
        if (progress > 0) {
            ctx.fillStyle = 'rgba(227, 227, 227, 0.7)';
            const pctSize = Math.max(10, Math.round(Math.min(canvasWidth * 0.018, 12)));
            ctx.font = `${pctSize}px 'Press Start 2P', ui-sans-serif, system-ui`;
            ctx.fillText(`${Math.round(progress)}%`, centerX, Math.round(centerY + snappedSize * 0.95));
        }

        ctx.textAlign = 'left'; // Reset text alignment
    };

    return null; // This component doesn't render anything directly
}

// Export the component and also expose a hook for using it
export { PixelLoadingAnimation };

// Custom hook for easier integration
export function usePixelLoadingAnimation() {
    const [loadingPixels, setLoadingPixels] = useState([]);
    const timeIntervalRef = useRef(1000 / 60);
    const timePreviousRef = useRef(performance.now());

    const generateLoadingPixels = useCallback((canvasWidth, canvasHeight) => {
        if (!canvasWidth || !canvasHeight) return [];

        // Match wordmark palette: white + pink
        const colors = ['#ffffff', '#e5e5e5', '#cfcfcf', '#a0a0a0', '#000000'];
        const gap = 12; // Larger gap for better visibility
        const speed = 0.05; // Slightly faster animation
        const pixels = [];

        for (let x = 0; x < canvasWidth; x += gap) {
            for (let y = 0; y < canvasHeight; y += gap) {
                const color = colors[Math.floor(Math.random() * colors.length)];
                const centerX = canvasWidth / 2;
                const centerY = canvasHeight / 2;
                const distance = Math.hypot(x - centerX, y - centerY);
                const delay = distance * 0.1; // Faster appearance

                pixels.push(new LoadingPixel(
                    { width: canvasWidth, height: canvasHeight },
                    null,
                    x, y, color, speed, delay
                ));
            }
        }
        return pixels;
    }, []);

    const drawLoadingAnimation = useCallback((ctx, {
        isLoading,
        progress,
        offset,
        pixelSize,
        canvasWidth,
        canvasHeight,
        loadingPixels: pixels,
        showText = true,
        subtitle = 'loading canvas...'
    }) => {
        if (!isLoading) return;

        // Dark background with gradient matching the design
        const gradient = ctx.createRadialGradient(
            canvasWidth * 0.7, -200, 0,
            canvasWidth * 0.7, -200, 1200
        );
        gradient.addColorStop(0, 'rgba(12, 12, 12, 0.8)');
        gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0)');

        const gradient2 = ctx.createRadialGradient(
            -200, canvasHeight * 0.8, 0,
            -200, canvasHeight * 0.8, 900
        );
        gradient2.addColorStop(0, 'rgba(18, 18, 18, 0.8)');
        gradient2.addColorStop(0.6, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        ctx.fillStyle = gradient2;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Animate background pixels
        const timeNow = performance.now();
        const timePassed = timeNow - timePreviousRef.current;

        if (timePassed >= timeIntervalRef.current) {
            timePreviousRef.current = timeNow - (timePassed % timeIntervalRef.current);

            pixels.forEach(pixel => {
                pixel.ctx = ctx;
                pixel.appear();
            });
        }

        // Center content (snapped)
        const centerX = Math.round(canvasWidth / 2);
        const centerY = Math.round(canvasHeight / 2);

        // pXiel wordmark with pixel font (snapped, no rotation)
        ctx.imageSmoothingEnabled = false;
        const baseSize = Math.min(canvasWidth * 0.12, 100);
        const snappedSize = Math.max(24, Math.round(baseSize / 8) * 8);
        ctx.font = `bold ${snappedSize}px 'Press Start 2P', ui-sans-serif, system-ui, -apple-system`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.filter = 'none';

        const widthFull = ctx.measureText('pXiel').width;
        const widthP = ctx.measureText('p').width;
        const widthPX = ctx.measureText('pX').width;
        const startX = Math.round(centerX - widthFull / 2);

        // p
        ctx.fillStyle = '#e3e3e3';
        ctx.fillText('p', startX, centerY);
        // X accent (white)
        ctx.fillStyle = '#ffffff';
        ctx.fillText('X', Math.round(startX + widthP), centerY);
        // iel
        ctx.fillStyle = '#e3e3e3';
        ctx.fillText('iel', Math.round(startX + widthPX), centerY);

        // Subtitle (optional)
        if (showText) {
            ctx.fillStyle = 'rgba(227, 227, 227, 0.8)';
            const subSize = Math.max(10, Math.round(Math.min(canvasWidth * 0.02, 16)));
            ctx.font = `${subSize}px 'Press Start 2P', ui-sans-serif, system-ui`;
            ctx.textAlign = 'center';
            ctx.fillText(subtitle, centerX, Math.round(centerY + snappedSize * 0.7));
            ctx.textAlign = 'left';
        }

        // Progress indicator
        if (showText && progress > 0) {
            ctx.fillStyle = 'rgba(227, 227, 227, 0.7)';
            const pctSize = Math.max(10, Math.round(Math.min(canvasWidth * 0.018, 12)));
            ctx.font = `${pctSize}px 'Press Start 2P', ui-sans-serif, system-ui`;
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.round(progress)}%`, centerX, Math.round(centerY + snappedSize * 0.95));
            ctx.textAlign = 'left';
        }
    }, []);

    return {
        loadingPixels,
        setLoadingPixels,
        generateLoadingPixels,
        drawLoadingAnimation
    };
}
