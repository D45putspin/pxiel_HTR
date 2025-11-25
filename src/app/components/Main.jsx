'use client'

import React, { useEffect } from 'react';
import Nav from './Nav';
import Section from './Section';
import WalletUtilService from '../lib/wallet-util-service.mjs';

const Main = () => {
    useEffect(() => {
        // Initialize the wallet utils (WalletConnect client is lazy-loaded)
        const walletService = WalletUtilService.getInstance();
        const rpcUrl = process.env.NEXT_PUBLIC_HATHOR_RPC || 'https://wallet-service.hathor.network';
        const bootstrap = async () => {
            try {
                await walletService.HathorWalletUtils.init(rpcUrl);
            } catch (e) {
                console.error('Failed to initialize wallet utils', e);
            }
        };
        bootstrap();
    }, []);

    return (
        <div className="app-container">
            <Nav />
            <Section />
        </div>
    );
}

export default Main;
