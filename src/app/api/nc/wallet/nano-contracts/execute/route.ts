import { NextRequest, NextResponse } from 'next/server';

const TARGET_BASE =
  process.env.NEXT_PUBLIC_WALLET_TARGET ||
  process.env.WALLET_TARGET ||
  'http://localhost:8000';

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const targetUrl = `${TARGET_BASE}/wallet/nano-contracts/execute`;

  // Use wallet ID from header, query, or default to 'alice' from env
  const walletId = req.headers.get('x-wallet-id')
    || url.searchParams.get('wallet_id')
    || process.env.NEXT_PUBLIC_WALLET_ID
    || 'alice';

  try {
    const body = await req.text();
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'content-type': req.headers.get('content-type') || 'application/json',
        'X-Wallet-Id': walletId,
      },
      body,
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
