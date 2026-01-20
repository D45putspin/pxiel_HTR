const DEFAULT_CONTRACT_ID = '000061c0684e5a5946771c1336d86372e54e2849c5179d28c6535bbe8a87f195';

export const CONTRACT_NAME =
  process.env.NEXT_PUBLIC_CANVAS_CONTRACT ||
  DEFAULT_CONTRACT_ID;

export const DEFAULT_SIZE = parseInt(process.env.NEXT_PUBLIC_CANVAS_SIZE || '500', 10);
export const PIXEL_PRICE_WEI =
  process.env.NEXT_PUBLIC_PIXEL_PRICE_WEI ||
  String(process.env.NEXT_PUBLIC_DEPOSIT_AMOUNT || '100'); // default 100 (matches sample deposit)

// Frontend hits the Next.js proxy by default to avoid CORS (see /api/nc/* route handlers)
export const WALLET_API_BASE = process.env.NEXT_PUBLIC_WALLET_API_BASE || '/api/nc';
export const WALLET_ID = process.env.NEXT_PUBLIC_WALLET_ID || 'alice';
export const WALLET_ADDRESS =
  process.env.NEXT_PUBLIC_WALLET_ADDRESS || 'WiGFcSYHhfRqWJ7PXYvhjULXtXCYD1VFdS';
export const DEPOSIT_TOKEN = process.env.NEXT_PUBLIC_DEPOSIT_TOKEN || '00';
export const DEPOSIT_AMOUNT = parseInt(process.env.NEXT_PUBLIC_DEPOSIT_AMOUNT || '100', 10);
