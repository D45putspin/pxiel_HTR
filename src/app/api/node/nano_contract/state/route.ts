import { NextRequest, NextResponse } from 'next/server';

// Upstream Hathor node base URL
const NODE_URL = process.env.NEXT_PUBLIC_HATHOR_NODE_URL || process.env.HATHOR_NODE_URL || 'http://localhost:8080/v1a';

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const targetUrl = new URL(`${NODE_URL}/nano_contract/state`);

    // Forward all search params
    url.searchParams.forEach((value, key) => targetUrl.searchParams.append(key, value));

    try {
        const upstream = await fetch(targetUrl.toString());
        const text = await upstream.text();

        return new NextResponse(text, {
            status: upstream.status,
            headers: {
                'content-type': upstream.headers.get('content-type') || 'application/json',
            },
        });
    } catch (err: any) {
        return NextResponse.json(
            { success: false, error: err?.message || 'Proxy error connecting to node' },
            { status: 502 },
        );
    }
}
