'use client'
import React, { useEffect, useState } from 'react';
import useStore from '@/app/lib/store';
import WalletUtilService from '@/app/lib/wallet-util-service.mjs';

const Nav = () => {
    const walletAddress = useStore(state => state.walletAddress);
    const isConnected = useStore(state => state.isConnected);
    const setWalletAddress = useStore(state => state.setWalletAddress);
    const hasProjectId = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID);
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectError, setConnectError] = useState(
        hasProjectId ? '' : 'Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env.local to enable WalletConnect.'
    );

    useEffect(() => {
        const utils = WalletUtilService.getInstance().HathorWalletUtils;
        let mounted = true;
        const bootstrap = async () => {
            try {
                await utils.init(process.env.NEXT_PUBLIC_HATHOR_RPC || 'https://wallet-service.hathor.network');
                const existing = utils.getActiveAddress?.();
                if (mounted && existing) setWalletAddress(existing);
            } catch (e) {
                console.error('WalletConnect init failed', e);
            }
        };
        bootstrap();
        return () => { mounted = false; };
    }, [setWalletAddress]);

    const formatWalletAddress = (address) => {
        if (!address || address === 'Not connected') return 'Not connected';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const connectWallet = async () => {
        setIsConnecting(true);
        setConnectError('');

        if (!hasProjectId) {
            setConnectError('Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env.local to enable WalletConnect.');
            setIsConnecting(false);
            return;
        }

        try {
            console.log('Attempting to connect wallet...');
            const walletService = WalletUtilService.getInstance();
            const walletInfo = await walletService.HathorWalletUtils.requestWalletInfo();
            console.log('Wallet info received:', walletInfo);

            const address = walletInfo?.address || walletInfo?.wallet?.address || null;
            console.log('Extracted address:', address, 'type:', typeof address, 'length:', address?.length);

            setWalletAddress(address);
            console.log('Address set in store:', address);
        } catch (error) {
            console.error('Failed to connect wallet:', error);
            setWalletAddress(null);
            setConnectError(error?.message || 'Wallet connection failed. Check WalletConnect setup.');
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnectWallet = async () => {
        try {
            await WalletUtilService.getInstance().HathorWalletUtils.disconnect?.();
        } catch (e) {
            console.error('Failed to disconnect wallet:', e);
        }
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
                                    <div className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></div>
                                </div>
                                {isConnected ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span className="wallet-address" id="wallet-address">
                                            {formatWalletAddress(walletAddress)}
                                        </span>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={disconnectWallet}
                                            style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                                        >
                                            Disconnect
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        className="btn btn-primary"
                                        onClick={connectWallet}
                                        disabled={isConnecting || !hasProjectId}
                                        style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                                        title={!hasProjectId ? 'Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable WalletConnect' : undefined}
                                    >
                                        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                                    </button>
                                )}
                                {connectError && !isConnected && (
                                    <div style={{ color: '#f5b7b1', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                        {connectError}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
};

export default Nav;
