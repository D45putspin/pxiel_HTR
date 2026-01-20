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
POLL_INTERVAL_SEC=${POLL_INTERVAL_SEC:-3}
BLUEPRINT_MINING_RETRIES=${BLUEPRINT_MINING_RETRIES:-120}
CONTRACT_MINING_RETRIES=${CONTRACT_MINING_RETRIES:-120}

print_json() {
  local payload="$1"
  if printf '%s\n' "$payload" | jq . >/dev/null 2>&1; then
    printf '%s\n' "$payload" | jq
  else
    printf '%s\n' "$payload"
  fi
}

json_field() {
  local payload="$1"
  local filter="$2"
  local value
  if ! value=$(printf '%s\n' "$payload" | jq -r "$filter" 2>/dev/null); then
    echo -e "${RED}❌ Resposta inválida (não é JSON)${NC}"
    printf '%s\n' "$payload"
    return 1
  fi
  printf '%s\n' "$value"
}

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
    local code
    code=$(json_field "$status" '.statusCode') || exit 1
    if [ "$code" = "3" ]; then
      echo -e "${GREEN}✅ Wallet está pronta${NC}"
      return 0
    fi
    sleep 2
  done
  echo -e "${RED}❌ Wallet não ficou pronta dentro do tempo esperado${NC}"
  curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/status" | jq 2>/dev/null || curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/status"
  exit 1
}

fetch_wallet_address() {
  echo "📮 Obtendo endereço controlado pela wallet..."
  local address_resp
  address_resp=$(curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/address")
  WALLET_ADDRESS=$(json_field "$address_resp" '.address // .addresses[0] // empty') || exit 1
  if [ -z "$WALLET_ADDRESS" ]; then
    echo -e "${RED}❌ Não foi possível obter um endereço para a wallet${NC}"
    print_json "$address_resp"
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
print_json "$BLUEPRINT_RESP"

BLUEPRINT_ID=$(json_field "$BLUEPRINT_RESP" '.hash') || exit 1

if [ -z "$BLUEPRINT_ID" ] || [ "$BLUEPRINT_ID" = "null" ]; then
  echo -e "${RED}❌ Erro ao registrar blueprint${NC}"
  print_json "$BLUEPRINT_RESP"
  exit 1
fi

echo -e "${GREEN}✅ Blueprint registrado com ID: $BLUEPRINT_ID${NC}"
echo ""
echo "⏳ Aguardando mineração do blueprint em um bloco..."

# Aguarda até que o blueprint seja minerado
for i in $(seq 1 "$BLUEPRINT_MINING_RETRIES"); do
  BLUEPRINT_TX_INFO=$(curl -s "$WALLET_API/wallet/transaction?id=$BLUEPRINT_ID" -H "X-Wallet-Id: $WALLET_ID")
  FIRST_BLOCK=$(json_field "$BLUEPRINT_TX_INFO" '.first_block') || exit 1
  IS_VOIDED=$(json_field "$BLUEPRINT_TX_INFO" '.is_voided // false') || exit 1

  if [ "$IS_VOIDED" = "true" ]; then
    echo ""
    echo -e "${RED}❌ Blueprint foi invalidado (voided)${NC}"
    echo "Detalhes da transação:"
    print_json "$BLUEPRINT_TX_INFO"
    exit 1
  fi
  if [ "$FIRST_BLOCK" != "null" ] && [ -n "$FIRST_BLOCK" ]; then
    echo -e "${GREEN}✅ Blueprint minerado no bloco: $FIRST_BLOCK${NC}"
    break
  fi

  if [ $((i % 10)) -eq 0 ]; then
    echo ""
    echo "Status da transação (tentativa $i):"
    printf '%s\n' "$BLUEPRINT_TX_INFO" | jq -c '{height, first_block, is_voided}' 2>/dev/null || printf '%s\n' "$BLUEPRINT_TX_INFO"
  fi
  printf "."
  sleep "$POLL_INTERVAL_SEC"
done

if [ "$FIRST_BLOCK" = "null" ] || [ -z "$FIRST_BLOCK" ]; then
  echo ""
  BLUEPRINT_TIMEOUT=$((BLUEPRINT_MINING_RETRIES * POLL_INTERVAL_SEC))
  echo -e "${RED}❌ Timeout: blueprint não foi minerado após ${BLUEPRINT_TIMEOUT}s${NC}"
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
      args: [500, 10]
    }
  }')

echo "Debug - Create Contract Payload:"
print_json "$CREATE_CONTRACT_PAYLOAD"

RESP=$(echo "$CREATE_CONTRACT_PAYLOAD" | curl -s -X POST \
  -H "X-Wallet-Id: $WALLET_ID" \
  -H "Content-Type: application/json" \
  -d @- \
  "$WALLET_API/wallet/nano-contracts/create")

echo "Debug - Create Contract Response:"
print_json "$RESP"

CONTRACT_ID=$(json_field "$RESP" '.hash') || exit 1

if [ -z "$CONTRACT_ID" ] || [ "$CONTRACT_ID" = "null" ]; then
  echo -e "${RED}❌ Erro ao criar contrato${NC}"
  echo "$RESP"
  exit 1
fi

echo -e "${GREEN}✅ Contrato criado: $CONTRACT_ID${NC}"

echo ""
echo "⏳ Aguardando mineração do contrato..."

for i in $(seq 1 "$CONTRACT_MINING_RETRIES"); do
  CONTRACT_TX=$(curl -s "$WALLET_API/wallet/transaction?id=$CONTRACT_ID" -H "X-Wallet-Id: $WALLET_ID")
  CONTRACT_BLOCK=$(json_field "$CONTRACT_TX" '.first_block') || exit 1
  CONTRACT_VOIDED=$(json_field "$CONTRACT_TX" '.is_voided // false') || exit 1

  if [ "$CONTRACT_VOIDED" = "true" ]; then
    echo ""
    echo -e "${RED}❌ Contrato foi invalidado (voided)${NC}"
    echo "Detalhes da transação:"
    print_json "$CONTRACT_TX"
    exit 1
  fi
  
  if [ "$CONTRACT_BLOCK" != "null" ] && [ -n "$CONTRACT_BLOCK" ]; then
    echo -e "${GREEN}✅ Contrato minerado no bloco: $CONTRACT_BLOCK${NC}"
    break
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo ""
    echo "Status da transação (tentativa $i):"
    printf '%s\n' "$CONTRACT_TX" | jq -c '{height, first_block, is_voided}' 2>/dev/null || printf '%s\n' "$CONTRACT_TX"
  fi
  printf "."
  sleep "$POLL_INTERVAL_SEC"
done

if [ "$CONTRACT_BLOCK" = "null" ] || [ -z "$CONTRACT_BLOCK" ]; then
  echo ""
  CONTRACT_TIMEOUT=$((CONTRACT_MINING_RETRIES * POLL_INTERVAL_SEC))
  echo -e "${RED}❌ Timeout: contrato não foi minerado após ${CONTRACT_TIMEOUT}s${NC}"
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
print_json "$INITIAL_STATE"

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
print_json "$PAINT_PAYLOAD"

PAINT_RESP=$(echo "$PAINT_PAYLOAD" | curl -s -X POST \
  -H "X-Wallet-Id: $WALLET_ID" \
  -H "Content-Type: application/json" \
  -d @- \
  "$WALLET_API/wallet/nano-contracts/execute")

echo "Debug - Paint Response:"
print_json "$PAINT_RESP"

PAINT_TX=$(json_field "$PAINT_RESP" '.hash') || exit 1

if [ -z "$PAINT_TX" ] || [ "$PAINT_TX" = "null" ]; then
  echo -e "${RED}❌ Erro ao pintar pixel${NC}"
  echo "$PAINT_RESP"
  
  # Check for error details
  ERROR=$(json_field "$PAINT_RESP" '.error // .message // "Unknown error"') || exit 1
  echo -e "${RED}Erro: $ERROR${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Transação de pintura criada: $PAINT_TX${NC}"
echo ""
echo "⏳ Aguardando mineração da execução..."

# Increased timeout and more detailed checking
for i in $(seq 1 80); do
  PAINT_TX_INFO=$(curl -s "$WALLET_API/wallet/transaction?id=$PAINT_TX" -H "X-Wallet-Id: $WALLET_ID")
  PAINT_BLOCK=$(json_field "$PAINT_TX_INFO" '.first_block') || exit 1
  
  # Check if transaction is voided or has errors
  IS_VOIDED=$(json_field "$PAINT_TX_INFO" '.is_voided // false') || exit 1
  
  if [ "$IS_VOIDED" = "true" ]; then
    echo ""
    echo -e "${RED}❌ Transação foi invalidada (voided)${NC}"
    echo "Detalhes da transação:"
    print_json "$PAINT_TX_INFO"
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
    printf '%s\n' "$PAINT_TX_INFO" | jq -c '{height, first_block, is_voided}' 2>/dev/null || printf '%s\n' "$PAINT_TX_INFO"
  fi
  
  printf "."
  sleep 3
done

if [ "$PAINT_BLOCK" = "null" ] || [ -z "$PAINT_BLOCK" ]; then
  echo ""
  echo -e "${RED}❌ Timeout: execução não foi minerada após 4 minutos${NC}"
  echo ""
  echo "Última informação da transação:"
  curl -s "$WALLET_API/wallet/transaction?id=$PAINT_TX" -H "X-Wallet-Id: $WALLET_ID" | jq 2>/dev/null || curl -s "$WALLET_API/wallet/transaction?id=$PAINT_TX" -H "X-Wallet-Id: $WALLET_ID"
  echo ""
  echo "Verificando se há mempool:"
  curl -s "$WALLET_API/wallet/transactions" -H "X-Wallet-Id: $WALLET_ID" | jq '.transactions[] | select(.tx_id == "'$PAINT_TX'")' 2>/dev/null || curl -s "$WALLET_API/wallet/transactions" -H "X-Wallet-Id: $WALLET_ID"
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

print_json "$FINAL_STATE"

# Verify paint_count increased
PAINT_COUNT=$(json_field "$FINAL_STATE" '.fields.paint_count // 0') || exit 1
FEES_COLLECTED=$(json_field "$FINAL_STATE" '.fields.fees_collected // 0') || exit 1

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
print_json "$PIXEL_INFO"
