#!/bin/bash
# Artillery Load Testing Script untuk Local/Sandbox Testing
# 
# Usage:
#   ./run-artillery-test.sh sandbox  # untuk testing lokal
#   ./run-artillery-test.sh testnet  # untuk testing testnet

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

# Check if Artillery is installed
if ! command -v artillery &> /dev/null; then
    echo "❌ Artillery not found. Installing..."
    npm install -g artillery
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

# Prepare Artillery configuration
ARTILLERY_CONFIG="benchmark-${ENVIRONMENT}.yml"
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

  processor: "./src/benchmark.ts"
  
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
HTML_REPORT="artillery-report-${ENVIRONMENT}-$(date +%Y%m%d-%H%M%S).html"

echo "📝 Results will be saved to:"
echo "   - JSON: $OUTPUT_FILE"
echo "   - HTML: $HTML_REPORT"

# Run the test with output capture
artillery run "$ARTILLERY_CONFIG" \
    --output "$OUTPUT_FILE" \
    --quiet

# Generate HTML report
if [ -f "$OUTPUT_FILE" ]; then
    echo "📊 Generating HTML report..."
    artillery report "$OUTPUT_FILE" --output "$HTML_REPORT"
    
    echo "✅ Artillery test completed!"
    echo ""
    echo "📋 Quick Stats:"
    
    # Extract key metrics from JSON
    if command -v jq &> /dev/null; then
        echo "   - Total Requests: $(jq -r '.aggregate.counters."http.requests" // 0' "$OUTPUT_FILE")"
        echo "   - Successful: $(jq -r '.aggregate.counters."http.responses" // 0' "$OUTPUT_FILE")"
        echo "   - Failed: $(jq -r '.aggregate.counters."http.request_rate" // 0' "$OUTPUT_FILE")"
        echo "   - Average Response Time: $(jq -r '.aggregate.summaries."http.response_time".mean // 0' "$OUTPUT_FILE")ms"
        echo "   - Max Response Time: $(jq -r '.aggregate.summaries."http.response_time".max // 0' "$OUTPUT_FILE")ms"
        echo "   - TPS Peak: $(jq -r '.aggregate.rates."http.request_rate" // 0' "$OUTPUT_FILE")"
    fi
    
    echo ""
    echo "📊 View detailed results:"
    echo "   - Open in browser: file://$(pwd)/$HTML_REPORT"
    echo "   - JSON data: $OUTPUT_FILE"
else
    echo "❌ Artillery test failed - no output file generated"
    exit 1
fi

echo ""
echo "🎉 Artillery load test completed successfully!"