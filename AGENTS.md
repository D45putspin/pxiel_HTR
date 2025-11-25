# Pxiel on Hathor Network – Development Guide (AGENT.md)

This guide explains how to port the **pxiel** collaborative pixel‑canvas dApp from the Xian chain to the **Hathor Network**. It is written for another AI agent to follow and includes technical details for both the nano‑contract (blueprint) and the front‑end integration. When following these instructions, ensure you understand the distinctions between Xian’s smart‑contract model and Hathor’s nano‑contract model.

## 1 Prerequisites and Setup

Before building on Hathor you must prepare a development environment and understand the nano‑contract model:

- **Blueprint SDK and Python 3.11** – Hathor blueprints are implemented in Python 3.11. The blueprint SDK requires Python 3.11 and the Hathor Core development environment:contentReference[oaicite:2]{index=2}. Ensure you have Python 3.11 installed.
- **Local development environment** – The [`nano-env-example`](https://github.com/HathorNetwork/nano-env-example) repository provides a Docker‑based environment with a local Hathor full node, mining service, and headless wallet. Use the `make` commands to spin up services:
  1. `make up` – starts all services including full node, miner and headless wallet.
  2. `make start-wallet` – launches the headless wallet for contract deployment.
  3. `make deploy-blueprints` – deploys your blueprints to the local network:contentReference[oaicite:3]{index=3}.
- **Reown (WalletConnect) project ID** – To integrate your front end with the Hathor wallet you will need a **project ID** from Reown (the provider behind WalletConnect). Register your project at <https://dashboard.reown.com> and record the `projectId`.
- **Xian contract source** – Have the original Xian contract code available for reference. You will translate its logic into a Hathor nano‑contract blueprint.

## 2 Understand Hathor’s DApp architecture

Hathor DApps are built differently from EVM‑based dApps:

- **Nano contracts and blueprints** – In Hathor, code and state are separated. A **blueprint** defines the code once, and multiple contract instances (nano contracts) reference that blueprint. This reduces audit costs and allows reuse:contentReference[oaicite:4]{index=4}. Each blueprint must implement an `initialize` method to create contract instances:contentReference[oaicite:5]{index=5}.
- **Integration points** – A Hathor DApp requires two integrations:contentReference[oaicite:6]{index=6}:
  1. **Integration with the network** – The front end must read blockchain state (e.g., current pixel colours) by querying a full node via the HTTP API. You may connect directly to a full node or run a back‑end service that proxies requests.
  2. **Integration with wallets** – Users sign transactions through Hathor’s official desktop or mobile wallet. Wallets expose a JSON‑RPC API and use **Reown/WalletConnect** as the transport layer:contentReference[oaicite:7]{index=7}. The front end should connect to the wallet via WalletConnect to request signatures.

### 2.1  DApp–wallet integration overview

WalletConnect acts as a transport layer over a relay service. A session is established between the DApp and wallet, enabling encrypted JSON‑RPC message exchange:contentReference[oaicite:8]{index=8}. The high‑level steps are:

1. The DApp creates a WalletConnect client (using Reown’s SDK) and connects to the relay service.
2. The client generates a pairing URI which is displayed as a QR code or deep link for the user to scan.
3. The user opens the Hathor wallet and scans the QR code; the wallet then subscribes to the same topic.
4. Once paired, the DApp can send JSON‑RPC requests (e.g. to sign nano‑contract transactions) and receive responses.

Implementing this flow in the front end is described later.

## 3 Designing the Pixel Board Blueprint

You will translate the Xian smart contract into a Hathor nano‑contract blueprint. Use the design methodology recommended in the “Get started with blueprint SDK” guide:contentReference[oaicite:9]{index=9}:

1. **Specify requirements** – The pxiel contract should:
   - Store a canvas of `size × size` pixels (initially 1 000 × 1 000).
   - Charge a fee for each pixel painted, paid in a chosen token (HTR or a custom token).
   - Allow the owner to change the fee and canvas size (within bounds).
   - Track how many pixels have been painted and total fees collected.
   - Record the last user and timestamp for each pixel.
2. **Model interactions** – Identify public methods:
   - `initialize` – sets up the owner, canvas size, fee token and amount.
   - `paint(x, y, color)` – allows users to paint a pixel by paying the fee.
   - `set_fee(new_amount)` – owner can adjust the fee.
   - `set_size(new_size)` – owner can change canvas size (max 256).
   - `withdraw()` – owner withdraws accumulated fees.
   - View methods: `get_pixel(x, y)`, `get_paint_count()`, optionally `get_size()`, `get_fee()` and `get_owner()`.
3. **Model state** – Use typed attributes for each state variable (owner address, size, fee token UID, fee amount, paint_count, fees_collected) and dictionaries for pixel data.
4. **Model creation** – The `initialize` method accepts optional parameters (e.g. size, fee token, fee amount) and stores them in state.
5. **Model execution & failure cases** – For each method, define conditions that trigger failure (e.g. invalid coordinates, incorrect deposit amount, unauthorised caller). On failure, raise `NCFail`.

### 3.1  Sample Pixel Board blueprint code

Below is a simplified blueprint skeleton demonstrating how to encode your Xian contract’s logic. It uses the blueprint SDK’s base classes and types:

```python
# pixel_board.py
from hathor.nanocontracts.blueprint import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.types import (
    TokenUid, NCDepositAction, public, view
)
from hathor.nanocontracts.exception import NCFail

class PixelBoard(Blueprint):
    """Collaborative pixel canvas blueprint for Hathor."""

    # State variables (type hints define persistent fields)
    owner: str
    size: int
    fee_token: TokenUid | None
    fee_amount: int
    paint_count: int
    fees_collected: int

    # Pixel storage
    pixels: dict[tuple[int, int], str]
    last_painted_by: dict[tuple[int, int], str]
    last_painted_at: dict[tuple[int, int], int]

    @public(allow_deposit=True)
    def initialize(self, ctx: Context,
                   size: int = 1000,
                   fee_token: TokenUid | None = None,
                   fee_amount: int = 1) -> None:
        """Initialise the canvas. Called once when creating a contract."""
        self.owner = ctx.caller
        # bound size (0 < size <= 256 for safety)
        if size <= 0 or size > 256:
            raise NCFail
        self.size = size
        self.fee_token = fee_token
        self.fee_amount = fee_amount
        self.paint_count = 0
        self.fees_collected = 0
        self.pixels = {}
        self.last_painted_by = {}
        self.last_painted_at = {}

    @public(allow_deposit=True)
    def paint(self, ctx: Context, x: int, y: int, color: str) -> None:
        """Paint a pixel on the canvas."""
        # Boundaries
        if not (0 <= x < self.size and 0 <= y < self.size):
            raise NCFail

        # Validate colour (#RRGGBB)
        if not (isinstance(color, str) and len(color) == 7 and color.startswith("#")
                and all(c in "0123456789abcdefABCDEF" for c in color[1:])):
            raise NCFail

        # Fee handling: if fee_token is defined, expect one deposit action
        if self.fee_token:
            actions = ctx.actions.get(self.fee_token, [])
            if len(actions) != 1 or not isinstance(actions[0], NCDepositAction):
                raise NCFail
            if actions[0].amount != self.fee_amount:
                raise NCFail

        # Update state
        self.pixels[(x, y)] = color
        self.last_painted_by[(x, y)] = ctx.caller
        self.last_painted_at[(x, y)] = ctx.now
        self.paint_count += 1
        self.fees_collected += self.fee_amount

    @public
    def set_fee(self, ctx: Context, new_amount: int) -> None:
        """Owner sets a new painting fee."""
        if ctx.caller != self.owner:
            raise NCFail
        self.fee_amount = new_amount

    @public
    def set_size(self, ctx: Context, new_size: int) -> None:
        """Owner changes canvas size (max 256)."""
        if ctx.caller != self.owner or not (0 < new_size <= 256):
            raise NCFail
        self.size = new_size

    @public(allow_withdrawal=True)
    def withdraw(self, ctx: Context) -> None:
        """Owner withdraws accumulated fees (using fee_token)."""
        if ctx.caller != self.owner:
            raise NCFail
        # Instruct the runtime to transfer the entire balance of fee_token to owner.
        # The SDK will translate this to a `NCWithdrawalAction`.
        # Example (pseudo-code):
        # ctx.withdraw(self.fee_token, self.fees_collected, to=self.owner)
        self.fees_collected = 0

    # View methods (read-only)
    @view
    def get_pixel(self, x: int, y: int) -> str:
        return self.pixels.get((x, y), "")

    @view
    def get_paint_count(self) -> int:
        return self.paint_count

    @view
    def get_size(self) -> int:
        return self.size

    @view
    def get_fee(self) -> int:
        return self.fee_amount

    @view
    def get_owner(self) -> str:
        return self.owner
This blueprint outlines the basic functionality. Note:

Use @public(allow_deposit=True) when the method expects token deposits and @public(allow_withdrawal=True) when it will withdraw tokens. The SDK uses actions from ctx.actions to validate deposits.

The withdraw method requires further implementation using ctx.withdraw(); consult the SDK documentation for the exact signature.

Keep the maximum canvas size at 256 to avoid large state and to align with Hathor’s recommended limits. You can adjust this if needed but must ensure it remains within testnet constraints.

3.2 Testing the blueprint
Write unit tests using the blueprint SDK’s test utilities (NCDepositAction, NCWithdrawalAction, Context). Create test cases for:

Successful contract initialization with default and custom parameters.

Painting a pixel with valid and invalid coordinates.

Colour validation (ensure it fails on invalid hex codes).

Fee validation (ensure deposit actions match fee_amount).

Owner-only actions like set_fee, set_size and withdraw.

View methods returning correct values.

Use the nano-env-example environment to run tests locally. Run make deploy-blueprints to deploy the blueprint in the local network and verify that a contract instance can be created and executed.

4 Deploying the Blueprint and Creating a Contract Instance
Once the blueprint passes tests, deploy it to Hathor testnet or mainnet:

Compile and deploy blueprint – Use the headless wallet’s API or the make deploy-blueprints command (in nano-env-example) to deploy the blueprint code. This will publish the blueprint on the network and return a blueprint ID.

Instantiate the contract – Call the blueprint’s initialize method via the wallet API (or a transaction broadcast) to create a new nano contract instance. Provide parameters such as size, fee_token (the token UID you want to charge in; could be HTR), and fee_amount. The transaction will assign the contract a contract ID.

Record IDs – Save the blueprint ID and contract ID; the front end will need the contract ID to interact with the canvas.

You can automate deployment in a script that uses the headless wallet’s JSON‑RPC API to call nc_blueprint_create and nc_contract_initialize (function names subject to the SDK).

5 Building the Front End
The front end should replicate pxiel’s user experience while integrating with Hathor’s network and wallet. This section outlines key components:

5.1 Reading contract state
Direct full-node integration – The front end can call the Hathor full node’s HTTP API to read contract state. For example, to read a pixel colour, you may send an HTTP GET request to:

bash
Copy code
GET /nano_contracts/<contract-id>/call/get_pixel?args=[x,y]
This returns the colour string. Similarly, call other view methods (get_paint_count, get_size, etc.) to update the UI.

Indexing – To improve performance, you may build a back-end indexer that caches pixel data and exposes a REST API to the front end. The official docs note that teams can delegate full-node calls to a back-end service for scalability
docs.hathor.network
.

5.2 Connecting to the wallet with WalletConnect
Follow the DApp–wallet integration workflow
docs.hathor.network
:

Install dependencies – In your JavaScript/TypeScript project, install @walletconnect/sign-client and @walletconnect/modal (or @walletconnect/universal-provider if you prefer a provider wrapper).

Initialize the client – Create a SignClient instance using your projectId and DApp metadata:

js
Copy code
import SignClient from "@walletconnect/sign-client";
import { WalletConnectModal } from "@walletconnect/modal";

const signClient = await SignClient.init({
  projectId: "<your_project_id>",
  relayUrl: "wss://relay.reown.com",
  metadata: {
    name: "Pxiel Hathor",
    description: "Collaborative pixel canvas on Hathor",
    url: "https://your-dapp-url",
    icons: ["https://your-dapp-url/icon.png"]
  }
});

const modal = new WalletConnectModal({
  projectId: "<your_project_id>",
  walletConnectVersion: 2
});
Create a session proposal – Specify required namespaces:

js
Copy code
const proposal = {
  requiredNamespaces: {
    hathor: {
      methods: ["htr_signWithAddress", "htr_sendNanoContractTx"],
      chains: ["hathor:mainnet"], // or "hathor:testnet"
      events: []
    }
  },
};

const { uri, approval } = await signClient.connect(proposal);
// Display the URI via the modal
modal.openModal({ uri });
const session = await approval();
The htr_signWithAddress method requests the user’s address; htr_sendNanoContractTx is used to send nano‑contract transactions.

Handle session events – After pairing, listen for session updates or disconnections. Store the session in state.

Request actions – When a user paints a pixel:

Prompt the user to select a colour and coordinates.

Create a transaction payload specifying the contract ID, method name (paint) and arguments (x, y, color). Include deposit details if you charge a fee.

Call signClient.request with the htr_sendNanoContractTx method and pass the payload. For example:

js
Copy code
const txParams = {
  contractId: "<contract_id>",
  method: "paint",
  args: [x, y, color],
  deposits: feeToken ? { [feeToken]: feeAmount } : {}
};

const result = await signClient.request({
  chain: "hathor:mainnet",
  topic: session.topic,
  request: {
    method: "htr_sendNanoContractTx",
    params: txParams,
  },
});
Wait for the wallet to prompt the user to confirm the transaction. Once signed and broadcast, update the canvas state.

Other methods – For set_fee, set_size and withdraw, follow similar patterns: build the transaction payload, call htr_sendNanoContractTx with the contract ID and method name, and wait for confirmation.

Disconnect – Provide a way for users to disconnect their wallet when they are done.

5.3 User interface considerations
Canvas rendering – Use an HTML <canvas> element or a grid of divs to render the pixel board. Load initial pixel data by calling get_pixel for each coordinate or by reading from an indexer. Update the pixel on screen immediately after a successful paint transaction.

Feedback – Show transaction status (pending, confirmed) and display errors if the transaction fails (e.g. insufficient fee).

Responsiveness – Consider limiting the visible area and implementing zoom to handle large boards.

Fee token selection – If you allow different tokens, provide a UI for the owner to choose the fee token when initializing the contract.

6 Additional Notes and Best Practices
Testing – Always deploy and test on nano‑testnet before going to mainnet. The nano contracts feature is still in beta
docs.hathor.network
.

Security – Validate all inputs carefully. Use the NCFail exception to revert state when conditions are not met. Only the owner should be able to change fees, canvas size or withdraw.

State size – Pixel data can become large. Keep board size within reasonable limits (≤ 256 × 256) to avoid hitting state size limits.

Back-end indexing – For a smoother UX, run a back-end service that listens to the blockchain and stores pixel updates. This allows the front end to fetch the entire board state quickly rather than calling get_pixel for each coordinate.

Token bridging – If you want to charge fees in a token originally issued on Xian, bridge it to Hathor using the EVM bridge. Lock the token on Xian and mint a representation on Hathor. This bridging process is separate from blueprint deployment.

7 Summary
To port pxiel to Hathor:

Set up a local development environment with Python 3.11 and Hathor’s nano-env-example.

Design and implement a blueprint that replicates the Xian contract’s logic using the blueprint SDK. Define state variables, implement initialize, paint, set_fee, set_size, withdraw and view methods. Ensure proper input validation and deposit handling.

Test the blueprint using unit tests and deploy it to the local network. Once stable, deploy to testnet/mainnet and record the blueprint and contract IDs.

Build the front end using React or similar frameworks. Integrate with a Hathor full node for reading state and with the wallet via Reown’s WalletConnect implementation for signing transactions. Follow the official DApp–wallet integration steps: sign up for a project ID, initialize the sign client, create a session proposal, display the QR code, and send nano‑contract transactions via htr_sendNanoContractTx
docs.hathor.network
.

Polish the UX by adding real-time canvas updates, user feedback and error handling.

By following this guide, another AI agent can build a fully functional pxiel canvas on the Hathor Network, leveraging nano contracts and the WalletConnect‑based wallet integration.




The **Build a DApp** page (currently open) outlines the milestones for developing a Hathor dApp, such as using nano contracts, integrating with the network and wallets, and operating infrastructure:contentReference[oaicite:14]{index=14}.  This complements the AGENT.md guide and confirms that a Hathor dApp must integrate a nano‑contract blueprint, a front end that reads the full‑node API, and a WalletConnect-based wallet connection.

Feel free to let me know if you need any refinements or further assistance!