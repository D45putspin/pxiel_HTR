import { NextRequest, NextResponse } from 'next/server';

// Upstream wallet service (headless wallet) base URL
const TARGET_BASE =
  process.env.NEXT_PUBLIC_WALLET_TARGET ||
  process.env.WALLET_TARGET ||
  'http://localhost:8000';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const targetUrl = new URL(`${TARGET_BASE}/wallet/nano-contracts/state`);

  // Forward all search params
  url.searchParams.forEach((value, key) => targetUrl.searchParams.append(key, value));

  // Allow wallet id from header or query for flexibility
  const walletId = req.headers.get('x-wallet-id') || url.searchParams.get('wallet_id') || '';

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'X-Wallet-Id': walletId,
      },
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Proxy error' },
      { status: 502 },
    );
  }
}
