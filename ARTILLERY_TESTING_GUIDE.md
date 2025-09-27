# Artillery Load Testing Guide

## 🚀 Quick Start

### Local Sandbox Testing (Recommended)
```bash
# Complete automated pipeline
./test-complete-pipeline.sh

# Or step by step:
npm run start:sandbox  # In terminal 1
./run-artillery-test.sh sandbox  # In terminal 2
```

### Testnet Testing
```bash
# Setup environment
export NEAR_NETWORK_ID=testnet
export FT_CONTRACT_ID=your-contract.testnet
export NEAR_SIGNER_ACCOUNT_ID=your-account.testnet
export NEAR_SIGNER_ACCOUNT_PRIVATE_KEY=ed25519:your-key

# Start API service
npm run start:testnet

# Run artillery test
./run-artillery-test.sh testnet
```

## 📊 Why Artillery is Skipped in CI

### Technical Reasons:
1. **⏰ Time Constraints**: GitHub Actions free tier has 2000 minutes/month limit
2. **⚡ Resource Intensive**: Artillery tests require 5-30 minutes sustained load
3. **🎯 Timeout Limits**: CI workflow has 20-minute timeout, insufficient for full benchmarks
4. **💰 Cost Optimization**: Preserving CI minutes for essential validations

### CI vs Local Testing Strategy:
- **CI**: Fast API validation, contract deployment verification, negative tests
- **Local**: Full Artillery load testing, TPS benchmarking, performance profiling

## 🔧 Artillery Configuration Explained

### Test Phases:
```yaml
phases:
  # Warm-up: 30s at 5 RPS
  - duration: 30
    arrivalRate: 5
    name: "Warm-up"
  
  # Ramp-up: 60s from 10 to 50 RPS  
  - duration: 60
    arrivalRate: 10
    rampTo: 50
    name: "Ramp-up"
    
  # Sustained: 120s at 100 RPS
  - duration: 120
    arrivalRate: 100
    name: "Sustained Load"
    
  # Peak: 60s from 150 to 200 RPS
  - duration: 60
    arrivalRate: 150
    rampTo: 200
    name: "Peak Load"
```

### Test Scenarios:
- **70%** Single FT transfers
- **20%** Health checks  
- **10%** Batch transfers

## 📈 Expected Performance

### Sandbox (Local):
- **Target TPS**: 200+
- **Response Time**: <500ms avg
- **Success Rate**: >95%

### Testnet:
- **Target TPS**: 100+
- **Response Time**: <1000ms avg  
- **Success Rate**: >90%

## 🛠️ Troubleshooting

### Contract Deployment Issues:
```bash
# Check if contract exists
curl -X POST http://127.0.0.1:3030 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "query", 
    "params": {
      "request_type": "view_code",
      "finality": "final",
      "account_id": "test.near"
    }
  }'
```

### API Service Not Responding:
```bash
# Check if service is running
curl http://127.0.0.1:3000/health

# Check logs
tail -f api.log
```

### Near Sandbox Issues:
```bash
# Check sandbox status
curl http://127.0.0.1:3030/status

# Reset sandbox
pkill -f near-sandbox
rm -rf ~/.near
npx near-sandbox init
```

## 📋 Results Interpretation

### Key Metrics:
- **Request Rate**: Requests per second achieved
- **Response Time**: Latency distribution (p50, p95, p99)
- **Error Rate**: Failed requests percentage
- **Throughput**: Successful transactions per second

### Success Criteria:
- ✅ **TPS >100**: Good performance
- ✅ **Response <1s**: Acceptable latency  
- ✅ **Errors <10%**: Acceptable failure rate
- ✅ **No timeouts**: System stability

## 🎯 Advanced Testing

### Custom Test Duration:
```bash
TEST_DURATION=600 ./test-complete-pipeline.sh  # 10 minutes
```

### Custom TPS Target:
```bash
MAX_TPS=500 ./test-complete-pipeline.sh
```

### Stress Testing:
```bash
# Run multiple concurrent Artillery instances
for i in {1..3}; do
  artillery run artillery-local.yml &
done
wait
```

## 📊 Monitoring

### Real-time Monitoring:
```bash
# Watch API logs
tail -f api.log | grep -E "(✅|❌|🚀)"

# Monitor system resources
htop

# Check network connections  
ss -tulpn | grep :3000
```

### Post-Test Analysis:
- Review HTML report for detailed metrics
- Check JSON file for raw data analysis
- Compare results across test runs
- Identify performance bottlenecks