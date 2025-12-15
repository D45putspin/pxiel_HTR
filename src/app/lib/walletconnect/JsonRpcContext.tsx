'use client';

import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import type { SendNanoContractRpcRequest, SendNanoContractTxResponse } from '@hathor/hathor-rpc-handler';
import { RpcMethods } from '@hathor/hathor-rpc-handler';
import { useWalletConnectClient } from './ClientContext';
import { resolveChainId } from './utils';

interface HathorRpc {
  sendNanoContractTx: (req: SendNanoContractRpcRequest) => Promise<SendNanoContractTxResponse>;
  requestAddress: () => Promise<string | null>;
}

interface JsonRpcContextValue {
  hathorRpc: HathorRpc;
  rpcResult?: {
    method?: string;
    valid: boolean;
    result: unknown;
  } | null;
  isRpcRequestPending: boolean;
}

const JsonRpcContext = createContext<JsonRpcContextValue | undefined>(undefined);

export function JsonRpcContextProvider({ children }: { children: React.ReactNode }) {
  const { client, session } = useWalletConnectClient();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<JsonRpcContextValue['rpcResult']>(null);

  const walletClientGuard = useCallback(() => {
    if (!client) throw new Error('WalletConnect is not initialized');
    if (!session) throw new Error('Session is not connected');
  }, [client, session]);

  const requestChainId = useCallback(
    () => resolveChainId(session, process.env.NEXT_PUBLIC_HATHOR_CHAIN),
    [session]
  );

  const hathorRpc: HathorRpc = useMemo(() => ({
    sendNanoContractTx: async (ncTxRpcReq) => {
      walletClientGuard();
      try {
        setPending(true);
        const chainId = requestChainId();
        const networkName = typeof chainId === 'string'
          ? (chainId.split(':')[1] || process.env.NEXT_PUBLIC_HATHOR_CHAIN || 'testnet')
          : (process.env.NEXT_PUBLIC_HATHOR_CHAIN || 'testnet');
        const paramsWithNetwork = {
          ...ncTxRpcReq.params,
          network: networkName,
        };
        const response = await client!.request<SendNanoContractTxResponse>({
          chainId,
          topic: session!.topic,
          request: {
            method: RpcMethods.SendNanoContractTx,
            params: paramsWithNetwork,
          },
        });
        setResult({
          method: RpcMethods.SendNanoContractTx,
          valid: true,
          result: response,
        });
        return response;
      } catch (error: any) {
        setResult({
          method: RpcMethods.SendNanoContractTx,
          valid: false,
          result: error?.message ?? error,
        });
        throw error;
      } finally {
        setPending(false);
      }
    },
    requestAddress: async () => {
      walletClientGuard();
      try {
        setPending(true);
        const chainId = requestChainId();
        const response = await client!.request<any>({
          chainId,
          topic: session!.topic,
          request: {
            method: RpcMethods.SignWithAddress,
            params: {},
          },
        });
        const address = response?.address || response?.result || (typeof response === 'string' ? response : response?.wallet?.address);
        setResult({
          method: RpcMethods.SignWithAddress,
          valid: Boolean(address),
          result: address,
        });
        return address || null;
      } catch (error: any) {
        setResult({
          method: RpcMethods.SignWithAddress,
          valid: false,
          result: error?.message ?? error,
        });
        throw error;
      } finally {
        setPending(false);
      }
    },
  }), [client, session, walletClientGuard, requestChainId]);

  const value = useMemo(() => ({
    hathorRpc,
    rpcResult: result,
    isRpcRequestPending: pending,
  }), [hathorRpc, result, pending]);

  return (
    <JsonRpcContext.Provider value={value}>
      {children}
    </JsonRpcContext.Provider>
  );
}

export function useJsonRpc() {
  const context = useContext(JsonRpcContext);
  if (!context) {
    throw new Error('useJsonRpc must be used within a JsonRpcContextProvider');
  }
  return context;
}
