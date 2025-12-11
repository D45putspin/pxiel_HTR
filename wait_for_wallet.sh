#!/bin/bash

# Wait for alice wallet to be ready

echo "⏳ Waiting for alice wallet to initialize..."

for i in {1..30}; do
  STATUS=$(curl -s -H "X-Wallet-Id: alice" http://localhost:8000/wallet/status)
  CODE=$(echo "$STATUS" | jq -r '.statusCode')
  
  if [ "$CODE" = "3" ]; then
    echo "✅ Alice wallet is READY!"
    echo "$STATUS" | jq
    echo ""
    echo "You can now paint pixels!"
    exit 0
  fi
  
  echo "Status: $CODE (waiting for 3...)"
  sleep 2
done

echo "❌ Timeout waiting for wallet. Current status:"
curl -s -H "X-Wallet-Id: alice" http://localhost:8000/wallet/status | jq
