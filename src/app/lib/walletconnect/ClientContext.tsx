'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type Client from '@walletconnect/sign-client';
import SignClient from '@walletconnect/sign-client';
import type { PairingTypes, SessionTypes } from '@walletconnect/types';
import { getSdkError } from '@walletconnect/utils';
import { WalletConnectModal } from '@walletconnect/modal';
import { DEFAULT_CHAIN, normalizeChainId } from './utils';

const REQUIRED_METHODS = ['htr_signWithAddress', 'htr_sendNanoContractTx'];
const OPTIONAL_METHODS = ['htr_createToken', 'htr_getBalance', 'htr_sendTransaction'];

const DEFAULT_METADATA = {
  name: 'pXiel Hathor',
  description: 'Collaborative pixel canvas on Hathor',
  url: typeof window === 'undefined' ? 'https://pxiel.app' : window.location.origin,
  icons: ['https://walletconnect.com/walletconnect-logo.png'],
};

interface WalletConnectContextValue {
  client?: Client;
  session?: SessionTypes.Struct;
  connect: (pairing?: { topic: string }) => Promise<SessionTypes.Struct | undefined>;
  disconnect: () => Promise<void>;
  isInitializing: boolean;
  isWaitingApproval: boolean;
  pairings: PairingTypes.Struct[];
  accounts: string[];
  chains: string[];
  relayerRegion: string;
  setRelayerRegion: (url: string) => void;
}

const ClientContext = createContext<WalletConnectContextValue | undefined>(undefined);

export function ClientContextProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<Client>();
  const [session, setSession] = useState<SessionTypes.Struct>();
  const [pairings, setPairings] = useState<PairingTypes.Struct[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [chains, setChains] = useState<string[]>([]);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isWaitingApproval, setIsWaitingApproval] = useState(false);
  const [relayerRegion, setRelayerRegion] = useState<string>(process.env.NEXT_PUBLIC_WALLETCONNECT_RELAY || 'wss://relay.reown.com');
  const prevRelayerValue = useRef<string>('');
  const modalRef = useRef<WalletConnectModal | null>(null);

  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!projectId) return;
    modalRef.current = new WalletConnectModal({
      projectId,
      walletConnectVersion: 2,
      standaloneChains: [DEFAULT_CHAIN],
    });
    return () => {
      modalRef.current?.closeModal?.();
      modalRef.current = null;
    };
  }, [projectId]);

  const resetState = useCallback(() => {
    setSession(undefined);
    setAccounts([]);
    setChains([]);
    setPairings([]);
  }, []);

  const onSessionConnected = useCallback(async (_session: SessionTypes.Struct) => {
    const allNamespaceAccounts = Object.values(_session.namespaces)
      .map((namespace) => namespace.accounts || [])
      .flat();
    const namespaceChains = Object.values(_session.namespaces)
      .map((namespace) => namespace.chains || [])
      .flat();

    setSession(_session);
    setAccounts(allNamespaceAccounts);
    setChains(namespaceChains);
    return _session;
  }, []);

  const _subscribeToEvents = useCallback(async (_client: Client) => {
    _client.on('session_ping', (args) => console.log('WalletConnect session_ping', args));
    _client.on('session_event', (args) => console.log('WalletConnect session_event', args));
    _client.on('session_update', ({ topic, params }) => {
      const { namespaces } = params;
      const updatedSession = _client.session.get(topic);
      if (updatedSession) {
        const merged = { ...updatedSession, namespaces };
        onSessionConnected(merged);
      }
    });
    _client.on('session_delete', () => {
      console.log('WalletConnect session deleted');
      resetState();
    });
  }, [onSessionConnected, resetState]);

  const _checkPersistedState = useCallback(async (_client: Client) => {
    setPairings(_client.pairing.getAll({ active: true }));
    if (session) return session;
    const persistedSessions = _client.session.getAll();
    if (persistedSessions.length > 0) {
      const lastSession = persistedSessions[persistedSessions.length - 1];
      await onSessionConnected(lastSession);
      return lastSession;
    }
    return undefined;
  }, [session, onSessionConnected]);

  const createClient = useCallback(async () => {
    if (!projectId) {
      console.error('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not configured.');
      return;
    }
    try {
      setIsInitializing(true);
      const _client = await SignClient.init({
        projectId,
        relayUrl: relayerRegion,
        metadata: DEFAULT_METADATA,
      });
      setClient(_client);
      prevRelayerValue.current = relayerRegion;
      await _subscribeToEvents(_client);
      await _checkPersistedState(_client);
    } catch (err) {
      console.error('WalletConnect client initialization failed', err);
    } finally {
      setIsInitializing(false);
    }
  }, [_checkPersistedState, _subscribeToEvents, relayerRegion, projectId]);

  useEffect(() => {
    if (!client || prevRelayerValue.current !== relayerRegion) {
      createClient();
    }
  }, [client, createClient, relayerRegion]);

  const connect = useCallback(async (pairing?: { topic: string }) => {
    if (!client) throw new Error('WalletConnect is not initialized');
    setIsWaitingApproval(true);
    try {
      const requestedMethods = Array.from(new Set([...REQUIRED_METHODS, ...OPTIONAL_METHODS]));
      const chainId = normalizeChainId(process.env.NEXT_PUBLIC_HATHOR_CHAIN || DEFAULT_CHAIN);
      const requiredNamespaces = {
        hathor: {
          methods: requestedMethods,
          chains: [chainId],
          events: [],
        },
      };
      const { uri, approval } = await client.connect({
        pairingTopic: pairing?.topic,
        requiredNamespaces,
      });
      if (uri && modalRef.current) {
        modalRef.current.openModal({ uri, standaloneChains: requiredNamespaces.hathor.chains });
      }
      const approvedSession = await approval();
      await onSessionConnected(approvedSession);
      setPairings(client.pairing.getAll({ active: true }));
      return approvedSession;
    } catch (err) {
      console.error('WalletConnect connect failed', err);
      throw err;
    } finally {
      setIsWaitingApproval(false);
      modalRef.current?.closeModal?.();
    }
  }, [client, onSessionConnected]);

  const disconnect = useCallback(async () => {
    if (!client) throw new Error('WalletConnect is not initialized');
    if (!session) throw new Error('Session is not connected');
    try {
      await client.disconnect({
        topic: session.topic,
        reason: getSdkError('USER_DISCONNECTED'),
      });
    } catch (error) {
      console.error('WalletConnect disconnect failed', error);
    } finally {
      resetState();
    }
  }, [client, session, resetState]);

  const value = useMemo(() => ({
    client,
    session,
    connect,
    disconnect,
    isInitializing,
    isWaitingApproval,
    pairings,
    accounts,
    chains,
    relayerRegion,
    setRelayerRegion,
  }), [client, session, connect, disconnect, isInitializing, isWaitingApproval, pairings, accounts, chains, relayerRegion]);

  return (
    <ClientContext.Provider value={value}>
      {children}
    </ClientContext.Provider>
  );
}

export function useWalletConnectClient() {
  const context = useContext(ClientContext);
  if (!context) {
    throw new Error('useWalletConnectClient must be used within a ClientContextProvider');
  }
  return context;
}

