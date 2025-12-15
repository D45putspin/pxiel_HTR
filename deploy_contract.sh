#!/bin/bash

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

WALLET_API=${WALLET_API:-http://localhost:8000}
WALLET_ID=${WALLET_ID:-alice}
WALLET_SEED=${WALLET_SEED:-"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"}
MAX_WALLET_RETRIES=${MAX_WALLET_RETRIES:-30}

start_wallet() {
  echo "🚀 Iniciando wallet ${WALLET_ID}..."
  curl -s -X POST "$WALLET_API/start" \
    -H "Content-Type: application/json" \
    -d "{\"wallet-id\": \"$WALLET_ID\", \"seed\": $(
      jq -Rs . <<< "$WALLET_SEED"
    )}" >/dev/null || true
}

wait_for_wallet_ready() {
  echo "⏳ Aguardando wallet ficar pronta..."
  for i in $(seq 1 "$MAX_WALLET_RETRIES"); do
    local status=$(curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/status")
    local code=$(echo "$status" | jq -r '.statusCode')
    if [ "$code" = "3" ]; then
      echo -e "${GREEN}✅ Wallet está pronta${NC}"
      return 0
    fi
    sleep 2
  done
  echo -e "${RED}❌ Wallet não ficou pronta dentro do tempo esperado${NC}"
  curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/status" | jq
  exit 1
}

fetch_wallet_address() {
  echo "📮 Obtendo endereço controlado pela wallet..."
  local address_resp
  address_resp=$(curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/address")
  WALLET_ADDRESS=$(echo "$address_resp" | jq -r '.address // .addresses[0] // empty')
  if [ -z "$WALLET_ADDRESS" ]; then
    echo -e "${RED}❌ Não foi possível obter um endereço para a wallet${NC}"
    echo "$address_resp" | jq
    exit 1
  fi
  echo -e "${GREEN}✅ Usando endereço: $WALLET_ADDRESS${NC}"
}

echo "🔍 Verificando pré-requisitos..."

# Check if miner is running
if ! docker ps | grep -q cpu-miner; then
  echo -e "${RED}❌ Minerador não está rodando!${NC}"
  echo "   Inicie com: docker-compose up -d cpu-miner"
  exit 1
fi

echo -e "${GREEN}✅ Minerador está rodando${NC}"

start_wallet
wait_for_wallet_ready
fetch_wallet_address

echo ""

echo "📦 Preparando código do blueprint..."

# UPDATED: Read from the fixed contract file
BLUEPRINT_CODE=$(cat contract/pixel_place.py)

echo "📤 Registrando blueprint na blockchain..."

# Cria a transação de on-chain blueprint
BLUEPRINT_RESP=$(curl -s -X POST \
  -H "X-Wallet-Id: $WALLET_ID" \
  -H "Content-Type: application/json" \
  -d "{\"code\": $(jq -Rs . <<< "$BLUEPRINT_CODE"), \"address\": \"$WALLET_ADDRESS\"}" \
  "$WALLET_API/wallet/nano-contracts/create-on-chain-blueprint")

echo "Debug - Blueprint Response:"
echo "$BLUEPRINT_RESP" | jq

BLUEPRINT_ID=$(echo "$BLUEPRINT_RESP" | jq -r '.hash')

if [ -z "$BLUEPRINT_ID" ] || [ "$BLUEPRINT_ID" = "null" ]; then
  echo -e "${RED}❌ Erro ao registrar blueprint${NC}"
  echo "$BLUEPRINT_RESP" | jq
  exit 1
fi

echo -e "${GREEN}✅ Blueprint registrado com ID: $BLUEPRINT_ID${NC}"
echo ""
echo "⏳ Aguardando mineração do blueprint em um bloco..."

# Aguarda até que o blueprint seja minerado
for i in $(seq 1 60); do
  FIRST_BLOCK=$(curl -s "$WALLET_API/wallet/transaction?id=$BLUEPRINT_ID" -H "X-Wallet-Id: $WALLET_ID" | jq -r '.first_block')
  if [ "$FIRST_BLOCK" != "null" ] && [ -n "$FIRST_BLOCK" ]; then
    echo -e "${GREEN}✅ Blueprint minerado no bloco: $FIRST_BLOCK${NC}"
    break
  fi
  printf "."
  sleep 3
done

if [ "$FIRST_BLOCK" = "null" ] || [ -z "$FIRST_BLOCK" ]; then
  echo ""
  echo -e "${RED}❌ Timeout: blueprint não foi minerado após 3 minutos${NC}"
  exit 1
fi

echo ""
sleep 5  # Aguarda mais tempo para garantir sincronização

echo ""
echo "🏗️ Criando nano contract..."

# Cria o contrato com os parâmetros corretos: size=10, fee_htr=10
CREATE_CONTRACT_PAYLOAD=$(jq -n \
  --arg blueprint_id "$BLUEPRINT_ID" \
  --arg address "$WALLET_ADDRESS" \
  '{
    blueprint_id: $blueprint_id,
    address: $address,
    data: {
      actions: [],
      args: [10, 10]
    }
  }')

echo "Debug - Create Contract Payload:"
echo "$CREATE_CONTRACT_PAYLOAD" | jq

RESP=$(echo "$CREATE_CONTRACT_PAYLOAD" | curl -s -X POST \
  -H "X-Wallet-Id: $WALLET_ID" \
  -H "Content-Type: application/json" \
  -d @- \
  "$WALLET_API/wallet/nano-contracts/create")

echo "Debug - Create Contract Response:"
echo "$RESP" | jq

CONTRACT_ID=$(echo "$RESP" | jq -r '.hash')

if [ -z "$CONTRACT_ID" ] || [ "$CONTRACT_ID" = "null" ]; then
  echo -e "${RED}❌ Erro ao criar contrato${NC}"
  echo "$RESP"
  exit 1
fi

echo -e "${GREEN}✅ Contrato criado: $CONTRACT_ID${NC}"

echo ""
echo "⏳ Aguardando mineração do contrato..."

for i in $(seq 1 60); do
  CONTRACT_TX=$(curl -s "$WALLET_API/wallet/transaction?id=$CONTRACT_ID" -H "X-Wallet-Id: $WALLET_ID")
  CONTRACT_BLOCK=$(echo "$CONTRACT_TX" | jq -r '.first_block')
  
  if [ "$CONTRACT_BLOCK" != "null" ] && [ -n "$CONTRACT_BLOCK" ]; then
    echo -e "${GREEN}✅ Contrato minerado no bloco: $CONTRACT_BLOCK${NC}"
    break
  fi
  printf "."
  sleep 3
done

if [ "$CONTRACT_BLOCK" = "null" ] || [ -z "$CONTRACT_BLOCK" ]; then
  echo ""
  echo -e "${RED}❌ Timeout: contrato não foi minerado após 3 minutos${NC}"
  exit 1
fi

echo ""
sleep 5  # Aguarda sincronização

echo "🔍 Verificando estado inicial do contrato..."
INITIAL_STATE=$(curl -s -G \
  -H "X-Wallet-Id: $WALLET_ID" \
  --data-urlencode "id=$CONTRACT_ID" \
  --data-urlencode "fields[]=paint_count" \
  --data-urlencode "fields[]=fees_collected" \
  --data-urlencode "fields[]=size" \
  --data-urlencode "fields[]=fee_htr" \
  "$WALLET_API/wallet/nano-contracts/state")

echo "Estado inicial:"
echo "$INITIAL_STATE" | jq

echo ""
echo "🎨 Pintando pixel (x=0, y=0, cor=#FF0000)..."

# Tenta pintar com fee exata de 10
PAINT_PAYLOAD=$(jq -n \
  --arg nc_id "$CONTRACT_ID" \
  --arg address "$WALLET_ADDRESS" \
  '{
    nc_id: $nc_id,
    method: "paint",
    address: $address,
    data: {
      actions: [{
        type: "deposit",
        token: "00",
        amount: 10
      }],
      args: [0, 0, "#FF0000"]
    }
  }')

echo "Debug - Paint Payload:"
echo "$PAINT_PAYLOAD" | jq

PAINT_RESP=$(echo "$PAINT_PAYLOAD" | curl -s -X POST \
  -H "X-Wallet-Id: $WALLET_ID" \
  -H "Content-Type: application/json" \
  -d @- \
  "$WALLET_API/wallet/nano-contracts/execute")

echo "Debug - Paint Response:"
echo "$PAINT_RESP" | jq

PAINT_TX=$(echo "$PAINT_RESP" | jq -r '.hash')

if [ -z "$PAINT_TX" ] || [ "$PAINT_TX" = "null" ]; then
  echo -e "${RED}❌ Erro ao pintar pixel${NC}"
  echo "$PAINT_RESP"
  
  # Check for error details
  ERROR=$(echo "$PAINT_RESP" | jq -r '.error // .message // "Unknown error"')
  echo -e "${RED}Erro: $ERROR${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Transação de pintura criada: $PAINT_TX${NC}"
echo ""
echo "⏳ Aguardando mineração da execução..."

# Increased timeout and more detailed checking
for i in $(seq 1 80); do
  PAINT_TX_INFO=$(curl -s "$WALLET_API/wallet/transaction?id=$PAINT_TX" -H "X-Wallet-Id: $WALLET_ID")
  PAINT_BLOCK=$(echo "$PAINT_TX_INFO" | jq -r '.first_block')
  
  # Check if transaction is voided or has errors
  IS_VOIDED=$(echo "$PAINT_TX_INFO" | jq -r '.is_voided // false')
  
  if [ "$IS_VOIDED" = "true" ]; then
    echo ""
    echo -e "${RED}❌ Transação foi invalidada (voided)${NC}"
    echo "Detalhes da transação:"
    echo "$PAINT_TX_INFO" | jq
    exit 1
  fi
  
  if [ "$PAINT_BLOCK" != "null" ] && [ -n "$PAINT_BLOCK" ]; then
    echo -e "${GREEN}✅ Execução minerada no bloco: $PAINT_BLOCK${NC}"
    break
  fi
  
  # Every 10 iterations, show transaction status
  if [ $((i % 10)) -eq 0 ]; then
    echo ""
    echo "Status da transação (tentativa $i):"
    echo "$PAINT_TX_INFO" | jq -c '{height, first_block, is_voided}'
  fi
  
  printf "."
  sleep 3
done

if [ "$PAINT_BLOCK" = "null" ] || [ -z "$PAINT_BLOCK" ]; then
  echo ""
  echo -e "${RED}❌ Timeout: execução não foi minerada após 4 minutos${NC}"
  echo ""
  echo "Última informação da transação:"
  curl -s "$WALLET_API/wallet/transaction?id=$PAINT_TX" -H "X-Wallet-Id: $WALLET_ID" | jq
  echo ""
  echo "Verificando se há mempool:"
  curl -s "$WALLET_API/wallet/transactions" -H "X-Wallet-Id: $WALLET_ID" | jq '.transactions[] | select(.tx_id == "'$PAINT_TX'")'
  exit 1
fi

echo ""
sleep 3

echo "👀 Consultando estado final do contrato..."

FINAL_STATE=$(curl -s -G \
  -H "X-Wallet-Id: $WALLET_ID" \
  --data-urlencode "id=$CONTRACT_ID" \
  --data-urlencode "fields[]=pixels" \
  --data-urlencode "fields[]=last_painted_by" \
  --data-urlencode "fields[]=last_painted_at" \
  --data-urlencode "fields[]=paint_count" \
  --data-urlencode "fields[]=fees_collected" \
  "$WALLET_API/wallet/nano-contracts/state")

echo "$FINAL_STATE" | jq

# Verify paint_count increased
PAINT_COUNT=$(echo "$FINAL_STATE" | jq -r '.fields.paint_count // 0')
FEES_COLLECTED=$(echo "$FINAL_STATE" | jq -r '.fields.fees_collected // 0')

echo ""
if [ "$PAINT_COUNT" -gt 0 ]; then
  echo -e "${GREEN}🎉 Sucesso! Pixel foi pintado${NC}"
  echo "   Total de pinturas: $PAINT_COUNT"
  echo "   Taxas coletadas: $FEES_COLLECTED centavos"
else
  echo -e "${YELLOW}⚠️  Contrato minerado mas paint_count = 0${NC}"
  echo "   Pode haver um problema na execução do método paint"
fi

echo ""
echo "📊 Resumo:"
echo "   Blueprint ID: $BLUEPRINT_ID"
echo "   Contract ID: $CONTRACT_ID"
echo "   Paint TX: $PAINT_TX"

echo ""
echo "🧪 Testando método de visualização get_pixel_info..."

# Using separate args for call-view-method
PIXEL_INFO=$(curl -s -X POST \
  -H "X-Wallet-Id: $WALLET_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"nc_id\": \"$CONTRACT_ID\",
    \"method\": \"get_pixel_info\",
    \"args\": [0, 0]
  }" \
  "$WALLET_API/wallet/nano-contracts/call-view-method")

echo "Informação do pixel (0,0):"
echo "$PIXEL_INFO" | jq
