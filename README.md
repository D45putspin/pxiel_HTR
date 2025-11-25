# pXiel — Collaborative Pixel Canvas

🎨 Express yourself on the blockchain, one pixel at a time.

pXiel is a decentralized collaborative pixel art canvas built on the Hathor blockchain. Paint pixels, create art, and leave your mark forever on an immutable, shared canvas.

## 🚀 Features

- **Decentralized Canvas**: Every pixel is recorded on-chain
- **Real-time Collaboration**: See pixels appear as transactions land
- **Smooth Controls**: Zoom, pan, and paint with a simple UI
- **Wallet Integration**: Connect your Hathor wallet to participate
- **1 HTR per pixel**: Frontend passes value; contract enforces the fee

## 🛠️ Tech Stack

- **Frontend**: Next.js 14, React 18
- **Styling**: Bulma
- **State**: Zustand
- **Indexing**: Apollo Client (GraphQL)
- **Blockchain**: Hathor Network + WalletConnect (Reown relay)

## 📋 Prerequisites

- Node.js 18+
- Hathor wallet (mobile/desktop) that supports WalletConnect v2
- Reown/WalletConnect `projectId` from <https://dashboard.reown.com>
- Access to Hathor testnet funds

## ⚙️ Environment Variables

Create `.env.local` in the project root (values shown are sensible defaults):

```bash
# RPC, WebSocket, and GraphQL indexer
NEXT_PUBLIC_HATHOR_RPC=https://wallet-service.hathor.network
NEXT_PUBLIC_HATHOR_WS_URL=                                    # optional; set to your node's WS endpoint
NEXT_PUBLIC_HATHOR_BDS=https://node1.testnet.hathor.network/v1a/graphql
NEXT_PUBLIC_HATHOR_CHAIN=hathor:testnet                       # or hathor:mainnet

# Canvas contract + settings
NEXT_PUBLIC_CANVAS_CONTRACT=con_pixel_canvas4
NEXT_PUBLIC_CANVAS_SIZE=500         # default is 32 if unset
NEXT_PUBLIC_PIXEL_PRICE_WEI=1000000000000000000  # 1 HTR in smallest units

# WalletConnect
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=                          # required: from Reown dashboard
NEXT_PUBLIC_WALLETCONNECT_RELAY=wss://relay.reown.com          # optional override
NEXT_PUBLIC_SITE_URL=https://pxiel.app                         # used in WC metadata
NEXT_PUBLIC_SITE_ICON=https://pxiel.app/icon.png               # used in WC metadata
# Toggle payment mode (true => native HTR value, false => allowance-based)
NEXT_PUBLIC_USE_VALUE_PAYMENT=false
```

Notes:

- The app has built-in defaults; env vars let you point to custom endpoints/contracts.
- The WebSocket monitor subscribes to `tm.event='Tx'` and filters by `contract` to stream paint events.
- WalletConnect requires the `projectId`; without it the modal cannot open.

## ▶️ Getting Started

1. Install dependencies

```bash
npm install
```

2. Start the dev server (port 4545)

```bash
npm run dev
```

Open `http://localhost:4545`.

## 🧭 Usage

1. Connect your Hathor wallet
2. Choose a color
3. Click a pixel to paint (wallet will prompt; 1 HTR per pixel)
4. Navigate the board:
   - `Ctrl + Scroll` to zoom
   - `Ctrl + Drag` to pan

Painted pixels appear in near real-time as transactions are observed via WebSocket.

## 🔗 Smart Contract Expectations

- Contract name from `NEXT_PUBLIC_CANVAS_CONTRACT` (default: `con_pixel_canvas4`)
- Exposes a `paint` method accepting coordinates and color
- Enforces a 1 HTR fee per pixel (frontend also sends `value`)

## 🧱 Scripts

- `npm run dev` — Next.js dev server on port 4545
- `npm run build` — Production build
- `npm run start` — Start production server on port 4545
- `npm run lint` — Lint the project

## 📄 License

MIT
