'use client'
import React, { useEffect } from 'react';
import useStore from '@/app/lib/store';
import WalletUtilService from '@/app/lib/wallet-util-service.mjs';
import { CONTRACT_NAME, WALLET_ADDRESS, WALLET_ID } from '@/app/lib/addresses';

const Nav = () => {
    const walletAddress = useStore(state => state.walletAddress);
    const walletId = useStore(state => state.walletId);
    const setWalletAddress = useStore(state => state.setWalletAddress);
    const setWalletId = useStore(state => state.setWalletId);

    useEffect(() => {
        // Seed defaults
        if (WALLET_ADDRESS && !walletAddress) setWalletAddress(WALLET_ADDRESS);
        if (WALLET_ID && !walletId) setWalletId(WALLET_ID);
        // Attempt WC session restore
        const restore = async () => {
            try {
                const w = WalletUtilService.getInstance().HathorWalletUtils;
                await w.init(process.env.NEXT_PUBLIC_HATHOR_RPC || 'https://wallet-service.hathor.network');
                const addr = w.getActiveAddress?.();
                if (addr) setWalletAddress(addr);
            } catch {
                // ignore
            }
        };
        restore();
    }, [walletAddress, walletId, setWalletAddress, setWalletId]);

    const hasWallet = Boolean(walletAddress);
    const formatWalletAddress = (address) => {
        if (!address || address === 'Not connected') return 'Not connected';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const disconnect = async () => {
        try {
            await WalletUtilService.getInstance().HathorWalletUtils.disconnect?.();
        } catch { }
        setWalletAddress(null);
    };

    return (
        <nav className="nav" aria-label="main navigation">
            <div className="container">
                <div className="nav-content">
                    <div className="nav-brand">
                        <a href="/" className="nav-logo">
                            <span>
                                p<span className="x-accent">X</span>iel
                            </span>
                        </a>
                    </div>

                    <div className="nav-menu">
                        <div className="nav-start">
                            {/* Future nav items can go here */}
                        </div>
                        <div className="nav-end">
                            <div className="wallet-status">
                                <div className="wallet-indicator">
                                    <div className={`status-dot ${hasWallet ? 'connected' : 'disconnected'}`}></div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span className="pill" title="Nano contract id in use">
                                        {CONTRACT_NAME.slice(0, 10)}…
                                    </span>
                                    <span className="pill">
                                        {walletAddress ? formatWalletAddress(walletAddress) : 'No address'}
                                    </span>
                                    {hasWallet && (
                                        <button
                                            className="btn btn-secondary"
                                            onClick={disconnect}
                                            style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                                        >
                                            Disconnect
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
};

export default Nav;
