#!/bin/bash

# Initialize alice wallet with 24-word seed

echo "🔧 Initializing alice wallet..."

curl -X POST http://localhost:8000/start \
  -H "Content-Type: application/json" \
  -d '{
    "wallet-id": "alice",
    "seed": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"
  }'

echo ""
echo ""
echo "✅ Checking wallet status:"
curl -s -H "X-Wallet-Id: alice" http://localhost:8000/wallet/status | jq

echo ""
echo "If statusCode is 3, alice is ready for painting!"
