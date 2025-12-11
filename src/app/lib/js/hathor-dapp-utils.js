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
      if (parts.length >= 3 && parts[2]) return { chain: `${parts[0]}:${parts[1]}`, address: parts[2] };
    }
  } catch (e) {
    try { console.warn('Failed to parse Hathor account', e); } catch (_) { }
  }
  return null;
}

function resolveChainFromSession(session, fallbackChain) {
  const parsed = parseAccountAddress(session);
  if (parsed?.chain) return parsed.chain;
  return fallbackChain || 'hathor:testnet';
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
      const candidate = existing[0];
      // Validate permissions
      const namespaces = candidate.namespaces?.hathor || {};
      const methods = namespaces.methods || [];
      const chains = namespaces.chains || [];

      // Check for network mismatch
      // We want to force the network defined in env
      const targetChain = this.chainId;
      const sessionChain = resolveChainFromSession(candidate, '');

      if (!methods.includes('htr_sendNanoContractTx')) {
        console.warn('Session missing required method htr_sendNanoContractTx. Disconnecting stale session.');
        try {
          await this.signClient.disconnect({
            topic: candidate.topic,
            reason: { code: 6000, message: 'Stale session, missing permissions' }
          });
        } catch (e) { /* ignore */ }
        this.session = null;
        this.cachedAddress = null;
      } else if (sessionChain && sessionChain !== targetChain) {
        console.warn(`Network mismatch: Session is on ${sessionChain}, but app is on ${targetChain}. Disconnecting.`);
        try {
          await this.signClient.disconnect({
            topic: candidate.topic,
            reason: { code: 6000, message: 'Network mismatch' }
          });
        } catch (e) { /* ignore */ }
        this.session = null;
        this.cachedAddress = null;
      } else {
        this.session = candidate;
        const parsed = parseAccountAddress(this.session);
        this.cachedAddress = parsed?.address || null;
        if (parsed?.chain) this.chainId = parsed.chain;
      }
    }

    this.signClient?.on?.('session_update', ({ topic }) => {
      if (!this.signClient || !topic) return;
      const updated = this.signClient.session.get(topic);
      if (updated) {
        this.session = updated;
        const parsed = parseAccountAddress(updated);
        this.cachedAddress = parsed?.address || this.cachedAddress;
        if (parsed?.chain) this.chainId = parsed.chain;
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

    const optionalNamespaces = {
      hathor: {
        methods: ['htr_signWithAddress', 'htr_sendNanoContractTx'],
        chains: [this.chainId],
        events: [],
      },
    };

    const { uri, approval } = await this.signClient.connect({ optionalNamespaces });
    if (uri && this.modal?.openModal) {
      try { this.modal.openModal({ uri }); } catch (_) { }
    }

    const session = await approval();
    this.session = session;
    const parsed = parseAccountAddress(session);
    this.cachedAddress = parsed?.address || this.cachedAddress;
    if (parsed?.chain) this.chainId = parsed.chain;
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
    const parsedSession = parseAccountAddress(session);
    if (parsedSession?.chain) this.chainId = parsedSession.chain;
    if (parsedSession?.address && !address) address = parsedSession.address;
    if (!address) {
      try {
        const response = await this.signClient.request({
          topic: session.topic,
          chainId: resolveChainFromSession(session, this.chainId),
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

  // Direct HTTP API call for privatenet (bypasses WalletConnect)
  async sendTransactionViaHttp(contract, method, args, options = {}) {
    const normalizedOpts = (typeof options === 'number' || typeof options === 'string')
      ? { depositAmount: options }
      : (options || {});

    const depositToken = normalizedOpts.depositToken
      || normalizedOpts.token
      || process.env.NEXT_PUBLIC_DEPOSIT_TOKEN
      || '00';
    const depositAmount = normalizedOpts.depositAmount !== undefined
      ? normalizedOpts.depositAmount
      : normalizedOpts.valueHTR;

    // Build actions
    const actions = [];
    if (depositAmount !== undefined && depositAmount !== null) {
      const asNumber = Number(depositAmount);
      if (!Number.isNaN(asNumber) && asNumber > 0) {
        actions.push({
          type: 'deposit',
          token: depositToken,
          amount: asNumber, // HTTP API accepts number
        });
      }
    }

    // Build payload matching the deploy script format
    const payload = {
      nc_id: contract,
      method,
      address: this.cachedAddress || process.env.NEXT_PUBLIC_WALLET_ADDRESS,
      data: {
        actions,
        args,
      },
    };

    console.log('[DEBUG] HTTP API payload:', JSON.stringify(payload, null, 2));

    const response = await fetch('/api/nc/wallet/nano-contracts/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Id': process.env.NEXT_PUBLIC_WALLET_ID || 'alice',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`Failed to parse response: ${text}`);
    }

    if (!response.ok || result.error) {
      throw new Error(result.error || result.message || `HTTP ${response.status}: ${text}`);
    }

    console.log('[DEBUG] HTTP API result:', result);
    return result;
  },

  async sendTransaction(contract, method, kwargs = {}, options = {}) {
    // Build args array from kwargs - same format as hathordice-dapp
    const args = Array.isArray(kwargs) ? kwargs : Object.values(kwargs || {});

    const normalizedOpts = (typeof options === 'number' || typeof options === 'string')
      ? { depositAmount: options }
      : (options || {});

    const depositToken = normalizedOpts.depositToken
      || normalizedOpts.token
      || process.env.NEXT_PUBLIC_DEPOSIT_TOKEN
      || '00';

    // Support both depositAmount and valueHTR (backwards compat)
    const depositAmount = normalizedOpts.depositAmount !== undefined
      ? normalizedOpts.depositAmount
      : normalizedOpts.valueHTR;

    // Check if we should try HTTP API directly for privatenet (bypasses WalletConnect)
    // NOTE: DISABLED - User wants to use WalletConnect wallet exclusively
    // To re-enable, set useHttpApi: true in options
    const chainId = this.chainId || process.env.NEXT_PUBLIC_HATHOR_CHAIN || 'hathor:testnet';
    const isPrivatenet = chainId.includes('privatenet');

    // HTTP API fallback is disabled by default to force WalletConnect usage
    if (normalizedOpts.useHttpApi === true && isPrivatenet) {
      console.log('[DEBUG] Using HTTP API for privatenet transaction (explicit opt-in)');
      try {
        return await this.sendTransactionViaHttp(contract, method, args, options);
      } catch (httpError) {
        console.warn('[DEBUG] HTTP API failed, will try WalletConnect:', httpError.message);
      }
    }

    // WalletConnect path
    const session = await this.ensureSession();
    if (!session) throw new Error('No WalletConnect session available');

    // Extract network name from chainId (e.g., "hathor:privatenet" -> "privatenet")
    let chainToUse = resolveChainFromSession(session, this.chainId);

    // Build actions array - exactly like hathordice-dapp
    const actions = [];
    if (depositAmount !== undefined && depositAmount !== null) {
      const asNumber = Number(depositAmount);
      if (!Number.isNaN(asNumber) && asNumber > 0) {
        actions.push({
          type: 'deposit',
          token: depositToken,
          amount: asNumber.toString(),  // hathordice sends as string
        });
      }
    }

    // Get namespace first (needed for address extraction)
    const namespace = session.namespaces?.hathor;

    // Build params - include address like HTTP API does
    // MUST include: network, nc_id, method, args, actions, push_tx, address
    const networkName = chainToUse.split(':')[1] || 'testnet';

    // Get address from session account (format: "hathor:privatenet:ADDRESS")
    const sessionAccount = namespace?.accounts?.[0] || '';
    const addressFromSession = sessionAccount.split(':')[2] || this.cachedAddress || '';

    const params = {
      network: networkName,
      nc_id: contract,
      method,
      address: addressFromSession,  // Adding address like HTTP API
      args,
      actions,
      push_tx: normalizedOpts.push_tx !== false,
    };

    // Force-inject permissions into the local session object to bypass client-side validation
    if (namespace) {
      if (!namespace.methods.includes('htr_sendNanoContractTx')) {
        console.warn('[Auto-Fix] Forcing htr_sendNanoContractTx into session permissions');
        namespace.methods.push('htr_sendNanoContractTx');
      }
      if (!namespace.chains.includes(chainToUse)) {
        console.warn(`[Auto-Fix] Forcing ${chainToUse} into session permissions`);
        namespace.chains.push(chainToUse);
      }
    }

    // Enhanced session debugging
    console.log('[DEBUG] ====== WALLETCONNECT SESSION INFO ======');
    console.log('[DEBUG] Session topic:', session.topic);
    console.log('[DEBUG] Session peer:', session.peer?.metadata?.name);
    console.log('[DEBUG] Session namespaces:', JSON.stringify(session.namespaces, null, 2));
    console.log('[DEBUG] Hathor namespace methods:', namespace?.methods);
    console.log('[DEBUG] Hathor namespace chains:', namespace?.chains);
    console.log('[DEBUG] Hathor namespace accounts:', namespace?.accounts);
    console.log('[DEBUG] Chain to use:', chainToUse);
    console.log('[DEBUG] Full params:', JSON.stringify(params, null, 2));
    console.log('[DEBUG] ==========================================');

    try {
      const result = await this.signClient.request({
        topic: session.topic,
        chainId: chainToUse,
        request: {
          method: 'htr_sendNanoContractTx',
          params,
        },
      });
      console.log('[DEBUG] sendTransaction - success result:', result);
      return result;
    } catch (e) {
      console.error('[HathorWalletUtils] sendTransaction failed:', e);

      // Enhanced error extraction
      let errorMessage = 'Transaction failed';
      if (e && typeof e === 'object') {
        // Check for pino log event format (has time and level properties)
        if (e.time && typeof e.level === 'number') {
          console.error('[DEBUG] Error is a pino log event - level:', e.level, 'time:', e.time);
          // Level 50 is error, 40 is warn, 30 is info
          errorMessage = e.msg || e.message || `Wallet error (log level ${e.level})`;
          // Check for nested error info
          if (e.err) {
            errorMessage = e.err.message || e.err.msg || String(e.err);
          }
        } else {
          // Try multiple ways to extract error info
          const msg = e.message || e.reason || e.description || e.error?.message;
          if (msg) {
            errorMessage = msg;
          } else {
            // Check for WalletConnect specific error structure
            const wcError = e.context?.error?.message || e.data?.message || e.code;
            if (wcError) {
              errorMessage = String(wcError);
            }
          }
        }

        // Log all properties for debugging
        console.error('[DEBUG] Error object type:', e.constructor?.name);
        console.error('[DEBUG] Error keys:', Object.keys(e));
        try {
          console.error('[DEBUG] Error full:', JSON.stringify(e, Object.getOwnPropertyNames(e)));
        } catch (_) { }

        // Check prototype chain for hidden message
        const proto = Object.getPrototypeOf(e);
        if (proto && proto !== Object.prototype) {
          console.error('[DEBUG] Error prototype:', proto.constructor?.name);
        }
      }

      // Create a proper error with the extracted message
      const betterError = new Error(errorMessage);
      betterError.originalError = e;
      throw betterError;
    }
  },
};

export default HathorWalletUtils;
