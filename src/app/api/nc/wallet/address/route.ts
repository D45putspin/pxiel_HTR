import { NextRequest, NextResponse } from 'next/server';

const TARGET_BASE =
    process.env.NEXT_PUBLIC_WALLET_TARGET ||
    process.env.WALLET_TARGET ||
    'http://localhost:8000';

export async function GET(req: NextRequest) {
    const walletId = req.headers.get('x-wallet-id')
        || process.env.NEXT_PUBLIC_WALLET_ID
        || 'alice';

    try {
        const upstream = await fetch(`${TARGET_BASE}/wallet/address`, {
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
