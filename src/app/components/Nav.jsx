'use client'
import React, { useEffect, useState } from 'react';
import useStore from '@/app/lib/store';
import WalletUtilService from '@/app/lib/wallet-util-service.mjs';

const Nav = () => {
    const walletAddress = useStore(state => state.walletAddress);
    const setWalletAddress = useStore(state => state.setWalletAddress);
    const [isConnecting, setIsConnecting] = useState(false);

    useEffect(() => {
        // Only restore from WalletConnect session - don't seed from env vars
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
    }, [setWalletAddress]);

    const hasWallet = Boolean(walletAddress);
    const formatWalletAddress = (address) => {
        if (!address || address === 'Not connected') return 'Not connected';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const connect = async () => {
        setIsConnecting(true);
        try {
            const w = WalletUtilService.getInstance().HathorWalletUtils;
            await w.init(process.env.NEXT_PUBLIC_HATHOR_RPC || 'https://wallet-service.hathor.network');
            const session = await w.connect();
            const addr = w.getActiveAddress?.();
            if (addr) setWalletAddress(addr);
        } catch (e) {
            console.error('Failed to connect wallet:', e);
        } finally {
            setIsConnecting(false);
        }
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
                                    {hasWallet ? (
                                        <>
                                            <span className="pill">
                                                {formatWalletAddress(walletAddress)}
                                            </span>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={disconnect}
                                                style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                                            >
                                                Disconnect
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            className="btn btn-primary"
                                            onClick={connect}
                                            disabled={isConnecting}
                                            style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                                        >
                                            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
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
