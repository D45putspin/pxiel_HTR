'use client';

// WalletConnect v2 client wrapper for Hathor wallets (Reown relay).
// Provides a minimal interface used by the app: init, requestWalletInfo, sendTransaction, disconnect.
let SignClientCtor = null;
let WalletConnectModalCtor = null;

async function loadWalletConnect() {
  if (!SignClientCtor) {
    const mod = await import('@walletconnect/sign-client');
    SignClientCtor = mod?.default || mod?.SignClient || mod;
  }
  if (!WalletConnectModalCtor) {
    const mod = await import('@walletconnect/modal');
    WalletConnectModalCtor = mod?.WalletConnectModal || mod?.default || mod;
  }
}

const defaultMetadata = {
  name: 'Pxiel Hathor',
  description: 'Collaborative pixel canvas on Hathor',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'https://pxiel.app',
  icons: [process.env.NEXT_PUBLIC_SITE_ICON || 'https://walletconnect.com/walletconnect-logo.png'],
};

function parseAccountAddress(session) {
  try {
    const accounts = session?.namespaces?.hathor?.accounts || [];
    for (const account of accounts) {
      const parts = String(account).split(':'); // e.g. hathor:testnet:<address>
      if (parts.length >= 3 && parts[2]) return parts[2];
    }
  } catch (e) {
    try { console.warn('Failed to parse Hathor account', e); } catch (_) { }
  }
  return null;
}

const HathorWalletUtils = {
  rpcUrl: 'https://wallet-service.hathor.network',
  signClient: null,
  modal: null,
  session: null,
  cachedAddress: null,
  projectId: null,
  chainId: process.env.NEXT_PUBLIC_HATHOR_CHAIN || 'hathor:testnet',
  relayUrl: process.env.NEXT_PUBLIC_WALLETCONNECT_RELAY || 'wss://relay.reown.com',
  initializing: null,

  async init(rpcUrl) {
    if (rpcUrl) this.rpcUrl = rpcUrl;
    if (this.signClient || this.initializing) return this.initializing;
    this.initializing = this._bootstrapSignClient().catch((err) => {
      // Reset so we can retry if the env var is fixed without a full reload
      this.initializing = null;
      throw err;
    });
    return this.initializing;
  },

  async _bootstrapSignClient() {
    if (typeof window === 'undefined') return null;
    await loadWalletConnect();

    this.projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';
    if (!this.projectId) {
      const err = new Error('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required for WalletConnect');
      console.error(err.message);
      throw err;
    }

    this.signClient = await SignClientCtor.init({
      projectId: this.projectId,
      relayUrl: this.relayUrl,
      metadata: defaultMetadata,
    });

    this.modal = WalletConnectModalCtor
      ? new WalletConnectModalCtor({ projectId: this.projectId, walletConnectVersion: 2 })
      : null;

    const existing = this.signClient?.session?.getAll?.() || [];
    if (existing.length > 0) {
      this.session = existing[0];
      this.cachedAddress = parseAccountAddress(this.session);
    }

    this.signClient?.on?.('session_update', ({ topic }) => {
      if (!this.signClient || !topic) return;
      const updated = this.signClient.session.get(topic);
      if (updated) {
        this.session = updated;
        this.cachedAddress = parseAccountAddress(updated) || this.cachedAddress;
      }
    });

    this.signClient?.on?.('session_delete', () => {
      this.session = null;
      this.cachedAddress = null;
    });

    return this.signClient;
  },

  getActiveAddress() {
    return this.cachedAddress || parseAccountAddress(this.session);
  },

  async ensureSession() {
    await this.init(this.rpcUrl);
    if (this.session) return this.session;
    return this.connect();
  },

  async connect() {
    await this.init(this.rpcUrl);
    if (!this.signClient) {
      throw new Error('WalletConnect client not initialized');
    }

    const requiredNamespaces = {
      hathor: {
        methods: ['htr_signWithAddress', 'htr_sendNanoContractTx'],
        chains: [this.chainId],
        events: [],
      },
    };

    const { uri, approval } = await this.signClient.connect({ requiredNamespaces });
    if (uri && this.modal?.openModal) {
      try { this.modal.openModal({ uri }); } catch (_) { }
    }

    const session = await approval();
    this.session = session;
    this.cachedAddress = parseAccountAddress(session) || this.cachedAddress;
    if (this.modal?.closeModal) {
      try { this.modal.closeModal(); } catch (_) { }
    }
    return session;
  },

  async disconnect() {
    if (this.session && this.signClient) {
      try {
        await this.signClient.disconnect({
          topic: this.session.topic,
          reason: { code: 6000, message: 'User disconnected' },
        });
      } catch (e) {
        try { console.warn('Wallet disconnect failed', e); } catch (_) { }
      }
    }
    this.session = null;
    this.cachedAddress = null;
  },

  async requestWalletInfo() {
    const session = await this.ensureSession();
    if (!session) throw new Error('No WalletConnect session available');

    let address = this.cachedAddress || parseAccountAddress(session);
    if (!address) {
      try {
        const response = await this.signClient.request({
          topic: session.topic,
          chain: this.chainId,
          request: { method: 'htr_signWithAddress', params: {} },
        });
        address = response?.address || response?.result || (typeof response === 'string' ? response : null);
      } catch (e) {
        console.warn('Failed to fetch address via WalletConnect', e);
      }
    }

    if (address) this.cachedAddress = address;
    return { address };
  },

  async sendTransaction(contract, method, kwargs = {}, valueHTR) {
    const session = await this.ensureSession();
    if (!session) throw new Error('No WalletConnect session available');

    const args = Array.isArray(kwargs) ? kwargs : Object.values(kwargs || {});
    const params = {
      contractId: contract,
      method,
      args,
    };

    if (!Array.isArray(kwargs) && kwargs && Object.keys(kwargs).length > 0) {
      params.kwargs = kwargs;
    }
    if (valueHTR !== undefined && valueHTR !== null) {
      params.value = valueHTR;
    }

    return this.signClient.request({
      topic: session.topic,
      chain: this.chainId,
      request: {
        method: 'htr_sendNanoContractTx',
        params,
      },
    });
  },
};

export default HathorWalletUtils;
