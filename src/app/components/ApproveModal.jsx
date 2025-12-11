'use client';

import React, { useEffect, useState } from 'react';

export default function ApproveModal({ isOpen, onClose, onApprove, currentAllowance = 0, pricePerPaint = 1 }) {
    const [amount, setAmount] = useState(10);

    useEffect(() => {
        if (isOpen) setAmount(10);
    }, [isOpen]);

    if (!isOpen) return null;

    const remainingPaints = Math.floor((currentAllowance || 0) / (pricePerPaint || 1));

    const handleApproveClick = async () => {
        const numeric = Number(amount);
        if (!Number.isFinite(numeric) || numeric <= 0) return;
        await onApprove(numeric);
    };

    return (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div className="pixel-frame" style={{ background: 'var(--bg-primary)', border: '1px solid rgba(255,255,255,0.18)', width: 'min(520px, 92vw)', padding: 20, color: 'var(--text-primary)', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <h3 style={{ margin: 0, fontSize: 18 }}>Approve HTR Allowance</h3>
                    <button className="btn" onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', color: 'var(--text-primary)', padding: '6px 10px' }}>✕</button>
                </div>

                <p style={{ margin: '8px 0 14px', color: 'var(--text-secondary)' }}>Grant the canvas contract permission to spend your HTR on the Hathor network. You will only need to approve occasionally.</p>

                <div className="control-group" style={{ marginBottom: 12 }}>
                    <label className="label" style={{ display: 'block', marginBottom: 6 }}>Current allowance</label>
                    <div className="pill" style={{ display: 'inline-block', padding: '6px 10px', border: '1px solid rgba(255,255,255,0.12)' }}>
                        {currentAllowance} HTR ({remainingPaints} paints available)
                    </div>
                </div>

                <div className="control-group" style={{ marginBottom: 12 }}>
                    <label className="label" style={{ display: 'block', marginBottom: 6 }}>Approve amount (HTR)</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                            type="number"
                            min={1}
                            step={1}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            style={{ flex: 1, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.12)', padding: '8px 10px' }}
                        />
                        <button className="btn" onClick={() => setAmount(10)} style={{ padding: '8px 10px' }}>10</button>
                        <button className="btn" onClick={() => setAmount(25)} style={{ padding: '8px 10px' }}>25</button>
                        <button className="btn" onClick={() => setAmount(100)} style={{ padding: '8px 10px' }}>100</button>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                    <button className="btn" onClick={onClose}>Cancel</button>
                    <button className="btn" onClick={handleApproveClick}>Approve</button>
                </div>

                <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>Security tip: Only approve what you plan to use. You can re-approve later.</p>
            </div>
        </div>
    );
}
