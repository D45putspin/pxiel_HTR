'use client'
import React, { useEffect, useState } from 'react';
import useStore from '@/app/lib/store';
import { useWalletConnectClient } from '@/app/lib/walletconnect/ClientContext';
import { useJsonRpc } from '@/app/lib/walletconnect/JsonRpcContext';
import { getAccountFromSession } from '@/app/lib/walletconnect/utils';

const Nav = () => {
    const walletAddress = useStore(state => state.walletAddress);
    const setWalletAddress = useStore(state => state.setWalletAddress);
    const [isConnecting, setIsConnecting] = useState(false);
    const { session, connect: establishSession, disconnect: disconnectWallet, isWaitingApproval } = useWalletConnectClient();
    const { hathorRpc } = useJsonRpc();

    useEffect(() => {
        if (!session) {
            setWalletAddress(null);
            return;
        }
        const parsed = getAccountFromSession(session);
        if (parsed?.address) {
            setWalletAddress(parsed.address);
        }
    }, [session, setWalletAddress]);

    const isSessionConnected = Boolean(session);
    const hasWalletAddress = Boolean(walletAddress);
    const formatWalletAddress = (address) => {
        if (!address || address === 'Not connected') return 'Not connected';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const connectWallet = async () => {
        setIsConnecting(true);
        try {
            const newSession = await establishSession();
            const parsed = getAccountFromSession(newSession || session);
            let address = parsed?.address || null;
            if (!address) {
                address = await hathorRpc.requestAddress();
            }
            if (address) setWalletAddress(address);
        } catch (e) {
            console.error('Failed to connect wallet:', e);
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnect = async () => {
        try {
            await disconnectWallet();
        } catch (e) {
            console.error('Wallet disconnect failed', e);
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
                                <div className={`status-dot ${isSessionConnected ? 'connected' : 'disconnected'}`}></div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    {isSessionConnected ? (
                                        <>
                                            <span className="pill">
                                                {hasWalletAddress ? formatWalletAddress(walletAddress) : 'Connected'}
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
                                            onClick={connectWallet}
                                            disabled={isConnecting || isWaitingApproval}
                                            style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                                        >
                                            {(isConnecting || isWaitingApproval) ? 'Connecting...' : 'Connect Wallet'}
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
