#!/bin/bash
# Artillery Load Testing Script  Local/Sandbox Testing
# 


set -euo pipefail

ENVIRONMENT=${1:-sandbox}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🎯 Starting Artillery Load Test for $ENVIRONMENT environment..."

# Validate environment
case $ENVIRONMENT in
  sandbox)
    echo "🏠 Local Sandbox Testing Mode"
    export NODE_URL="http://127.0.0.1:3000"
    export TARGET_URL="http://127.0.0.1:3000"
    ;;
  testnet)
    echo "🌐 Testnet Testing Mode"
    export NODE_URL="https://rpc.testnet.near.org"
    export TARGET_URL="http://127.0.0.1:3000"  # Local API service pointing to testnet
    ;;
  *)
    echo "❌ Invalid environment. Use: sandbox or testnet"
    exit 1
    ;;
esac

# Check prerequisites
echo "📋 Checking prerequisites..."

# Use npx to run artillery (prefer Node 20+ for undici File support)
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
else
  NODE_MAJOR=0
fi

if [ "$NODE_MAJOR" -ge 20 ]; then
  ARTILLERY_CMD="npx artillery"
else
  ARTILLERY_CMD="npx --yes -p node@20 -p artillery@2.0.26 artillery"
fi

# Check if API service is running
if ! curl -sS "${TARGET_URL}/health" >/dev/null 2>&1; then
    echo "❌ API service not responding at ${TARGET_URL}"
    echo "💡 Start the API service first:"
    if [ "$ENVIRONMENT" = "sandbox" ]; then
        echo "   npm run start:sandbox"
    else
        echo "   npm run start:testnet"
    fi
    exit 1
fi

echo "✅ API service is running at ${TARGET_URL}"

# Prepare Artillery configuration (allows override via ARTILLERY_CONFIG env)
ARTILLERY_CONFIG="${ARTILLERY_CONFIG:-}"
if [ -n "$ARTILLERY_CONFIG" ]; then
  if [ ! -f "$ARTILLERY_CONFIG" ]; then
    echo "❌ Custom Artillery config not found: $ARTILLERY_CONFIG"
    exit 1
  fi
  echo "🛠️  Using custom Artillery config: $ARTILLERY_CONFIG"
else
  ARTILLERY_CONFIG="benchmark-${ENVIRONMENT}.yml"
fi

if [ ! -f "$ARTILLERY_CONFIG" ]; then
    echo "📝 Creating Artillery config: $ARTILLERY_CONFIG"
    cat > "$ARTILLERY_CONFIG" << EOF
config:
  target: '${TARGET_URL}'
  phases:
    # Warm-up phase
    - duration: 30
      arrivalRate: 5
      name: "Warm-up"
    
    # Ramp-up phase
    - duration: 60
      arrivalRate: 10
      rampTo: 50
      name: "Ramp-up"
    
    # Peak load phase
    - duration: 120
      arrivalRate: 100
      name: "Peak Load"
    
    # High-load stress test
    - duration: 60
      arrivalRate: 150
      rampTo: 200
      name: "Stress Test"
  
  variables:
    receiverId:
      - "user1.test.near"
      - "user2.test.near" 
      - "user3.test.near"
      - "alice.test.near"
      - "bob.test.near"
    
    amount:
      - "1000000000000000000000000"   # 1 token
      - "5000000000000000000000000"   # 5 tokens
      - "10000000000000000000000000"  # 10 tokens

scenarios:
  - name: "Send FT Token"
    weight: 80
    flow:
      - post:
          url: "/send-ft"
          headers:
            Content-Type: "application/json"
          json:
            receiverId: "{{ receiverId }}"
            amount: "{{ amount }}"
            memo: "Artillery load test - {{ \$timestamp }}"
          capture:
            - json: "$.transactionHash"
              as: "txHash"
          expect:
            - statusCode: 200
            - hasProperty: "transactionHash"

  - name: "Health Check"
    weight: 10
    flow:
      - get:
          url: "/health"
          expect:
            - statusCode: 200

  - name: "Batch Transfer"
    weight: 10
    flow:
      - post:
          url: "/send-ft"
          headers:
            Content-Type: "application/json"
          json:
            transfers:
              - receiverId: "{{ receiverId }}"
                amount: "{{ amount }}"
                memo: "Batch test"
              - receiverId: "user1.test.near"
                amount: "1000000000000000000000000"
                memo: "Batch test 2"
          expect:
            - statusCode: 200
EOF
fi

# Run Artillery test
echo "🚀 Starting Artillery load test..."
echo "📊 Configuration: $ARTILLERY_CONFIG"
echo "🎯 Target: $TARGET_URL"

OUTPUT_FILE="artillery-results-${ENVIRONMENT}-$(date +%Y%m%d-%H%M%S).json"
echo "📝 Results will be saved to:"
echo "   - JSON: $OUTPUT_FILE"
# Deprecated: Artillery 2.x no longer supports local HTML report generation.

# Run the test with output capture
$ARTILLERY_CMD run "$ARTILLERY_CONFIG" \
    --output "$OUTPUT_FILE" \
    --quiet

if [ -f "$OUTPUT_FILE" ]; then
    echo "✅ Artillery test completed!"
    echo ""
    echo "📋 Quick Stats:"
    
    # Extract key metrics from JSON (Artillery 2.x schema)
    if command -v jq &> /dev/null; then
      TOTAL_REQUESTS=$(jq -r '.aggregate.counters["http.requests"] // 0' "$OUTPUT_FILE")
      SUCCESSFUL=$(jq -r '.aggregate.counters["http.codes.200"] // 0' "$OUTPUT_FILE")
  FAIL_4XX=$(jq -r '[.aggregate.counters | to_entries[] | select(.key | test("^http\\.codes\\.4")) | .value] | add // 0' "$OUTPUT_FILE")
      FAIL_5XX=$(jq -r '.aggregate.counters["http.codes.500"] // 0' "$OUTPUT_FILE")
      TIMEOUTS=$(jq -r '.aggregate.counters["errors.ETIMEDOUT"] // 0' "$OUTPUT_FILE")
      ECONNRESET=$(jq -r '.aggregate.counters["errors.ECONNRESET"] // 0' "$OUTPUT_FILE")
      LATENCY_MEDIAN=$(jq -r '.aggregate.summaries["http.response_time"].median // 0' "$OUTPUT_FILE")
      LATENCY_P95=$(jq -r '.aggregate.summaries["http.response_time"].p95 // 0' "$OUTPUT_FILE")
      LATENCY_MAX=$(jq -r '.aggregate.summaries["http.response_time"].max // 0' "$OUTPUT_FILE")
      TPS_MEAN=$(jq -r '.aggregate.rates["http.request_rate"] // 0' "$OUTPUT_FILE")

  TOTAL_FAILURES=$((TOTAL_REQUESTS - SUCCESSFUL))

      echo "   - Total Requests: ${TOTAL_REQUESTS}"
      echo "   - Successful (200s): ${SUCCESSFUL}"
      echo "   - Failed Requests: ${TOTAL_FAILURES}"
      echo "     · HTTP 5xx: ${FAIL_5XX}"
      echo "     · HTTP 4xx: ${FAIL_4XX}"
      echo "     · ETIMEDOUT: ${TIMEOUTS}"
      echo "     · ECONNRESET: ${ECONNRESET}"
      echo "   - Latency Median: ${LATENCY_MEDIAN} ms"
      echo "   - Latency p95: ${LATENCY_P95} ms"
      echo "   - Latency Max: ${LATENCY_MAX} ms"
      echo "   - Avg Requests/sec: ${TPS_MEAN}"
    fi
    
    echo ""
    echo "📊 View detailed results:"
    echo "   - JSON data: $OUTPUT_FILE"
    echo "   - Note: Local HTML report generation is no longer available in Artillery 2.x"
  echo "RESULT_JSON=$OUTPUT_FILE"
else
    echo "❌ Artillery test failed - no output file generated"
    exit 1
fi

echo ""
echo "🎉 Artillery load test completed successfully!"