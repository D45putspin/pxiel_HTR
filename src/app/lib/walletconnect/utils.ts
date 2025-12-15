'use client';

import type { SessionTypes } from '@walletconnect/types';

const HATHOR_NAMESPACE = 'hathor';
const DEFAULT_NETWORK_REFERENCE = 'testnet';

export function normalizeChainId(chainLike?: string | null) {
  if (!chainLike) return `${HATHOR_NAMESPACE}:${DEFAULT_NETWORK_REFERENCE}`;
  const trimmed = `${chainLike}`.trim();
  if (!trimmed) return `${HATHOR_NAMESPACE}:${DEFAULT_NETWORK_REFERENCE}`;
  const parts = trimmed.split(':').filter(Boolean);
  if (parts.length >= 2) {
    const [namespace, reference] = parts;
    return `${namespace || HATHOR_NAMESPACE}:${reference || DEFAULT_NETWORK_REFERENCE}`;
  }
  return `${HATHOR_NAMESPACE}:${parts[0] || DEFAULT_NETWORK_REFERENCE}`;
}

export const DEFAULT_CHAIN = normalizeChainId(process.env.NEXT_PUBLIC_HATHOR_CHAIN || `${HATHOR_NAMESPACE}:${DEFAULT_NETWORK_REFERENCE}`);

export function getHathorNamespace(session?: SessionTypes.Struct) {
  if (!session?.namespaces) return null;
  if (session.namespaces.hathor) return session.namespaces.hathor;
  if (session.namespaces.htr) return session.namespaces.htr;
  for (const ns of Object.values(session.namespaces)) {
    const accounts = ns?.accounts || [];
    if (accounts.some((acc) => String(acc).startsWith('hathor:'))) {
      return ns;
    }
  }
  return null;
}

export function getAccountFromSession(session?: SessionTypes.Struct) {
  try {
    const namespace = getHathorNamespace(session);
    const accounts = namespace?.accounts || [];
    for (const account of accounts) {
      const parts = String(account).split(':');
      if (parts.length >= 3 && parts[2]) {
        return {
          chain: normalizeChainId(`${parts[0]}:${parts[1]}`),
          address: parts.slice(2).join(':'),
        };
      }
    }
  } catch {
    // ignore parsing failures
  }
  return null;
}

export function resolveChainId(session?: SessionTypes.Struct, fallback?: string | null) {
  const parsed = getAccountFromSession(session);
  if (parsed?.chain) return parsed.chain;
  if (fallback === undefined) return DEFAULT_CHAIN;
  if (!fallback) return fallback;
  return normalizeChainId(fallback);
}

