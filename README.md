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
# Wallet service (headless) + RPC
NEXT_PUBLIC_HATHOR_RPC=http://localhost:8000
NEXT_PUBLIC_WALLET_API_BASE=/api/nc                         # proxies to wallet service to avoid CORS
WALLET_TARGET=http://localhost:8000                         # upstream headless wallet base (server-side proxy)
NEXT_PUBLIC_WALLET_ID=alice
NEXT_PUBLIC_WALLET_ADDRESS=WiGFcSYHhfRqWJ7PXYvhjULXtXCYD1VFdS
# Nano contract + settings
NEXT_PUBLIC_CANVAS_CONTRACT=000061c0684e5a5946771c1336d86372e54e2849c5179d28c6535bbe8a87f195
NEXT_PUBLIC_CANVAS_SIZE=32
NEXT_PUBLIC_PIXEL_PRICE_WEI=100              # defaults to deposit amount if unset
NEXT_PUBLIC_DEPOSIT_TOKEN=00                 # HTR
NEXT_PUBLIC_DEPOSIT_AMOUNT=100               # matches sample curl body

# WalletConnect (optional; not required for the local headless wallet flow)
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_WALLETCONNECT_RELAY=wss://relay.reown.com
NEXT_PUBLIC_SITE_URL=https://pxiel.app
NEXT_PUBLIC_SITE_ICON=https://pxiel.app/icon.png
NEXT_PUBLIC_USE_VALUE_PAYMENT=true
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

1. Make sure the local wallet service is running (e.g. `make start-wallet` in nano-env) and `X-Wallet-Id: alice` has funds.
2. Choose a color.
3. Click a pixel to paint (default deposit: 100 of token `00`/HTR).
4. Navigate the board:
   - `Ctrl + Scroll` to zoom
   - `Ctrl + Drag` to pan

Canvas state is pulled from the wallet service; use the Reload button after switching networks or restarting the local node.

## 🛰️ Local nano-contract API

If you're running the local `nano-env` stack, the UI talks directly to the headless wallet service using `X-Wallet-Id: alice`:

- Read pixel + stats  
  `GET http://localhost:8000/wallet/nano-contracts/state?id=<nc_id>&calls[]=get_pixel_info(0,0)&calls[]=get_stats()`
- Paint a pixel
  ```json
  {
    "nc_id": "<nc_id>",
    "method": "paint",
    "address": "WiGFcSYHhfRqWJ7PXYvhjULXtXCYD1VFdS",
    "data": {
      "actions": [{ "type": "deposit", "token": "00", "amount": 100 }],
      "args": [x, y, "#RRGGBB"]
    }
  }
  ```

## 🔗 Smart Contract Expectations

- Contract id from `NEXT_PUBLIC_CANVAS_CONTRACT` (default: `000061c0684e5a5946771c1336d86372e54e2849c5179d28c6535bbe8a87f195`)
- Exposes a `paint` method accepting coordinates and color plus `get_pixel_info`/`get_stats` views
- Enforces the configured deposit per pixel (defaults to 100 of token `00`)

## 🧱 Scripts

- `npm run dev` — Next.js dev server on port 4545
- `npm run build` — Production build
- `npm run start` — Start production server on port 4545
- `npm run lint` — Lint the project

## 📄 License

MIT
