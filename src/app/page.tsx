'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import PixelLoadingAnimation, { usePixelLoadingAnimation } from './components/PixelLoadingAnimation.jsx';

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isClient, setIsClient] = useState(false);
  const { loadingPixels, setLoadingPixels, generateLoadingPixels, drawLoadingAnimation } = usePixelLoadingAnimation() as any;

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDimensions({ width: w, height: h });
      const pixels = generateLoadingPixels(w, h);
      setLoadingPixels(pixels as any);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [isClient, generateLoadingPixels, setLoadingPixels]);

  useEffect(() => {
    if (!isClient) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf;
    const loop = () => {
      drawLoadingAnimation(ctx, {
        isLoading: true,
        progress: 0,
        offset: 0,
        pixelSize: 1,
        canvasWidth: dimensions.width,
        canvasHeight: dimensions.height,
        loadingPixels,
        showText: false
      });
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [isClient, dimensions, loadingPixels, drawLoadingAnimation]);

  return (
    <main className="landing">
      <canvas ref={canvasRef} width={dimensions.width} height={dimensions.height} className="landing-canvas" aria-hidden></canvas>

      <div className="landing-overlay">
        <div className="landing-card pixel-frame">
          <div className="brand">
            <h1 className="brand-title">
              p<span className="x-accent">X</span>iel
            </h1>
            <p className="brand-sub">Collaborative pixel canvas on Hathor</p>
          </div>

          <div className="cta-row">
            <Link href="/dapp" className="btn btn-enter pixel-frame">
              Enter dApp
            </Link>
            <a href="https://hathor.network" target="_blank" rel="noreferrer" className="btn btn-secondary">Learn Hathor</a>
          </div>

          <div className="hint-mini">Press <kbd>Enter</kbd> to enter the dApp</div>
        </div>
        
        <section className="concept pixel-frame">
          <h2 className="concept-title">What is the Board?</h2>
          <p className="concept-text">
            A massive, shared pixel canvas where every wallet can place pixels in real-time.
            <br></br><br></br>Each pixel is stored on-chain, making your art permanent.
            <br></br><br></br>Leave your mark forever on the immutable canvas.
          </p>
          <div className="concept-grid">
            <div className="concept-item">
              <span className="concept-badge">1</span>
              <div className="concept-head">Place Pixels</div>
              <div className="concept-body">Select a color and click anywhere to paint.</div>
            </div>
            <div className="concept-item">
              <span className="concept-badge">2</span>
              <div className="concept-head">Own Your Art</div>
              <div className="concept-body">Actions are signed by your wallet on Hathor.</div>
            </div>
            <div className="concept-item">
              <span className="concept-badge">3</span>
              <div className="concept-head">Collaborate</div>
              <div className="concept-body">Build together, fight for space, leave your mark.</div>
            </div>
          </div>

        </section>
      </div>
    </main>
  );
}
