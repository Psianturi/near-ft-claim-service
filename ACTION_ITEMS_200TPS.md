# Action Items & Checklist - Mencapai 200 TPS

> **Last Updated**: 2025-01-09  
> **Target Completion**: 2025-02-28 (8 weeks)  
> **Current Status**: Planning Phase

---

## 🎯 Decision Point

**PILIH SATU PATH SEBELUM MELANJUTKAN:**

### Option A: Sandbox Optimization (1 week, $0)
- ✅ Target: 50-60 TPS sustained
- ✅ Use case: CI smoke tests, local development
- ✅ Complexity: Low
- ⏱️ Timeline: 1 week

### Option B: Testnet Migration (6-8 weeks, $60-100/month)
- ✅ Target: 200+ TPS sustained
- ✅ Use case: Production-ready benchmarks
- ✅ Complexity: Medium-High
- ⏱️ Timeline: 6-8 weeks

**🔥 REKOMENDASI**: Option B (Testnet) untuk mencapai target 200 TPS

---

## 📋 Path A: Sandbox Optimization Checklist

### Week 1: Configuration & Testing

#### Day 1-2: Update Artillery Configuration
- [ ] Create `testing/artillery/benchmark-sandbox-optimized.yml`
  - [ ] Set `arrivalRate: 50` for sustained phase
  - [ ] Reduce `timeout: 60` (from 120s)
  - [ ] Reduce `pool: 100` (from 200)
  - [ ] Reduce `maxSockets: 200` (from 600)
- [ ] Test locally:
  ```bash
  ARTILLERY_PROFILE=benchmark-sandbox-optimized.yml \
  ./testing/test-complete-pipeline.sh
  ```
- [ ] Validate results: success rate >90%

#### Day 3-4: Optimize Service Configuration
- [ ] Update `.env`:
  ```bash
  CONCURRENCY_LIMIT=300        # Reduce from 600
  MAX_IN_FLIGHT_PER_KEY=5      # Reduce from 8
  BATCH_SIZE_MAX=20            # Reduce from 50
  ```
- [ ] Update `testing/test-complete-pipeline.sh`:
  ```bash
  SANDBOX_KEY_POOL_SIZE=6      # Reduce from 12
  CLUSTER_WORKERS=2            # Reduce from 4
  MAX_TPS=60                   # Reduce from 180
  ```
- [ ] Test again and validate

#### Day 5-7: Update GitHub Actions
- [ ] Modify `.github/workflows/benchmark.yml`:
  ```yaml
  env:
    TEST_DURATION: 780
    MAX_TPS: 60
    CLUSTER_WORKERS: 2
    ARTILLERY_PROFILE: benchmark-sandbox-optimized.yml
  ```
- [ ] Run workflow manually
- [ ] Validate CI results
- [ ] Update success criteria in workflow
- [ ] Document final configuration

### Deliverables
- [ ] New Artillery profile for realistic sandbox testing
- [ ] Updated service configuration
- [ ] CI/CD passing with 50+ TPS
- [ ] Documentation updated

---

## 📋 Path B: Testnet Migration Checklist

### Phase 1: Testnet Environment Setup (Week 1-2)

#### Week 1, Day 1-3: Account Creation & Key Management
- [ ] Create master testnet account:
  ```bash
  near create-account ft-benchmark.testnet \
    --masterAccount yours.testnet \
    --initialBalance 100
  ```
- [ ] Generate 12 full-access keys:
  ```bash
  node ci/provision-master-keys.mjs \
    --env testnet \
    --account ft-benchmark.testnet \
    --count 12
  ```
- [ ] Store keys securely:
  - [ ] Export to `.env.testnet`
  - [ ] Backup to password manager
  - [ ] Add to GitHub Secrets (for CI)
- [ ] Verify all keys work:
  ```bash
  node scripts/validate-config.mjs --env testnet
  ```

#### Week 1, Day 4-5: Contract Deployment
- [ ] Create FT contract account:
  ```bash
  near create-account ft.ft-benchmark.testnet \
    --masterAccount ft-benchmark.testnet \
    --initialBalance 10
  ```
- [ ] Deploy FT contract:
  ```bash
  near deploy \
    --accountId ft.ft-benchmark.testnet \
    --wasmFile fungible_token.wasm
  ```
- [ ] Initialize contract:
  ```bash
  near call ft.ft-benchmark.testnet new \
    '{"owner_id":"ft-benchmark.testnet","total_supply":"1000000000000000000000000000"}' \
    --accountId ft-benchmark.testnet
  ```
- [ ] Mint tokens to master:
  ```bash
  near call ft.ft-benchmark.testnet ft_mint \
    '{"account_id":"ft-benchmark.testnet","amount":"500000000000000000000000000"}' \
    --accountId ft-benchmark.testnet
  ```
- [ ] Verify balance:
  ```bash
  near view ft.ft-benchmark.testnet ft_balance_of \
    '{"account_id":"ft-benchmark.testnet"}'
  ```

#### Week 2, Day 1-3: Receiver Accounts
- [ ] Create 100 receiver accounts:
  ```bash
  node ci/setup-test-accounts.mjs \
    --env testnet \
    --master ft-benchmark.testnet \
    --count 100 \
    --prefix user
  ```
- [ ] Register storage deposits:
  ```bash
  node ci/bootstrap-storage.mjs \
    --env testnet \
    --contract ft.ft-benchmark.testnet \
    --accounts user-*.testnet
  ```
- [ ] Verify storage registration:
  ```bash
  near view ft.ft-benchmark.testnet storage_balance_of \
    '{"account_id":"user-1.testnet"}'
  ```
- [ ] Document account list in `testnet-accounts.txt`

#### Week 2, Day 4-5: Baseline Benchmark
- [ ] Create `.env.testnet`:
  ```bash
  cp .env.example .env.testnet
  # Edit with testnet values
  ```
- [ ] Update Artillery config for testnet:
  ```yaml
  # testing/artillery/benchmark-testnet-baseline.yml
  phases:
    - duration: 120
      arrivalRate: 20
      rampTo: 50
    - duration: 600
      arrivalRate: 50
  ```
- [ ] Run baseline benchmark:
  ```bash
  NEAR_ENV=testnet \
  NODE_URL=https://rpc.testnet.near.org \
  ARTILLERY_PROFILE=benchmark-testnet-baseline.yml \
  ./testing/test-complete-pipeline.sh
  ```
- [ ] Document baseline TPS (expected: ~40-50 TPS)
- [ ] Identify bottlenecks before optimization

### Phase 2: Service Optimization (Week 3-4)

#### Week 3: Redis Implementation
- [ ] Setup Redis:
  ```bash
  # Local development
  docker run -d --name redis -p 6379:6379 redis:7-alpine
  
  # Or production
  # Sign up for Redis Cloud free tier
  ```
- [ ] Install Redis client:
  ```bash
  npm install ioredis
  ```
- [ ] Implement `RedisJobQueue`:
  - [ ] Create `src/queue/redis-queue.ts`
  - [ ] Implement `push()`, `pop()`, `complete()`, `fail()`
  - [ ] Add atomic operations
  - [ ] Add expiry tracking
- [ ] Implement `NonceCoordinator`:
  - [ ] Create `src/signer/nonce-coordinator.ts`
  - [ ] Atomic nonce increment
  - [ ] Key-based nonce tracking
  - [ ] Initialization & reset methods
- [ ] Integration:
  - [ ] Modify `src/index.ts` to use Redis conditionally
  - [ ] Add `ENABLE_REDIS_QUEUE=true` to `.env.testnet`
  - [ ] Add `REDIS_URL` configuration
- [ ] Testing:
  - [ ] Unit tests for Redis queue
  - [ ] Unit tests for nonce coordinator
  - [ ] Integration test with testnet
- [ ] Benchmark:
  ```bash
  NEAR_ENV=testnet ENABLE_REDIS_QUEUE=true \
  ./testing/test-complete-pipeline.sh
  ```
- [ ] Validate: TPS should increase by 20-30%

#### Week 4: Dynamic Batching & Circuit Breaker
- [ ] Implement dynamic batching:
  ```typescript
  // src/batch/dynamic-batcher.ts
  getBatchSize(): number {
    const queueDepth = await this.queue.getQueueDepth();
    return Math.min(
      Math.max(this.minBatchSize, Math.floor(queueDepth / 10)),
      this.maxBatchSize
    );
  }
  ```
- [ ] Implement circuit breaker:
  ```bash
  npm install opossum
  ```
  ```typescript
  // src/rpc/circuit-breaker.ts
  const breaker = new CircuitBreaker(nearRpcCall, {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
  });
  ```
- [ ] Integration & testing
- [ ] Benchmark again
- [ ] Document improvements

### Phase 3: Horizontal Scaling (Week 5-6)

#### Week 5: Multi-Instance Setup
- [ ] Create Docker Compose configuration:
  ```yaml
  # docker-compose.yml
  services:
    nginx:
      image: nginx:alpine
      ports: ["8000:8000"]
      volumes: ["./nginx.conf:/etc/nginx/nginx.conf"]
    
    api-1:
      build: .
      environment:
        PORT: 3001
        REDIS_URL: redis://redis:6379
    
    api-2:
      build: .
      environment:
        PORT: 3002
        REDIS_URL: redis://redis:6379
    
    api-3:
      build: .
      environment:
        PORT: 3003
        REDIS_URL: redis://redis:6379
    
    api-4:
      build: .
      environment:
        PORT: 3004
        REDIS_URL: redis://redis:6379
    
    redis:
      image: redis:7-alpine
  ```
- [ ] Create Nginx configuration:
  ```nginx
  # nginx.conf
  upstream api_backend {
    least_conn;
    server api-1:3001;
    server api-2:3002;
    server api-3:3003;
    server api-4:3004;
  }
  
  server {
    listen 8000;
    location / {
      proxy_pass http://api_backend;
      proxy_http_version 1.1;
    }
  }
  ```
- [ ] Test locally:
  ```bash
  docker-compose up
  ```
- [ ] Validate all instances healthy:
  ```bash
  curl http://localhost:8000/health  # Should round-robin
  ```

#### Week 6: Load Testing & Tuning
- [ ] Create 200 TPS Artillery config:
  ```yaml
  # testing/artillery/benchmark-testnet-200tps.yml
  phases:
    - duration: 120
      arrivalRate: 50
      rampTo: 150
    - duration: 600
      arrivalRate: 200  # Target!
    - duration: 60
      arrivalRate: 50
  ```
- [ ] Run 200 TPS benchmark:
  ```bash
  docker-compose up -d
  ARTILLERY_TARGET=http://localhost:8000 \
  npx artillery run testing/artillery/benchmark-testnet-200tps.yml \
    --output results-200tps.json
  ```
- [ ] Analyze results:
  ```bash
  node scripts/report-benchmark.mjs results-200tps.json
  ```
- [ ] If not meeting target:
  - [ ] Profile CPU usage
  - [ ] Check memory consumption
  - [ ] Review Redis performance
  - [ ] Tune batch sizes
  - [ ] Adjust concurrency limits
- [ ] Iterate until success criteria met

### Phase 4: Validation & Production (Week 7-8)

#### Week 7: Monitoring & Observability
- [ ] Setup Prometheus:
  ```yaml
  # docker-compose.yml
  prometheus:
    image: prom/prometheus
    ports: ["9090:9090"]
    volumes: ["./prometheus.yml:/etc/prometheus/prometheus.yml"]
  ```
- [ ] Setup Grafana:
  ```yaml
  grafana:
    image: grafana/grafana
    ports: ["3001:3000"]
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
  ```
- [ ] Create Grafana dashboard:
  - [ ] TPS gauge
  - [ ] Success rate percentage
  - [ ] Latency percentiles (P50, P95, P99)
  - [ ] Queue depth graph
  - [ ] Error rate by type
- [ ] Configure alerts:
  - [ ] TPS < 180 for 5 minutes
  - [ ] Success rate < 90%
  - [ ] P95 latency > 8s
  - [ ] Queue depth > 5000

#### Week 8: Final Validation & Documentation
- [ ] Run final 200 TPS benchmark (10 minutes):
  ```bash
  ./run-final-benchmark.sh
  ```
- [ ] Validate success criteria:
  - [ ] Total requests: 120,000+
  - [ ] Success rate: >95%
  - [ ] Mean TPS: 200+
  - [ ] P95 latency: <5s
  - [ ] P99 latency: <10s
  - [ ] ETIMEDOUT: 0
- [ ] Update documentation:
  - [ ] Update README.md with new benchmarks
  - [ ] Update ARTILLERY_TESTNET_RESULTS.md
  - [ ] Document configuration in docs/
  - [ ] Create runbook for operations
- [ ] Update CI/CD:
  - [ ] Create `.github/workflows/benchmark-testnet.yml`
  - [ ] Add testnet secrets
  - [ ] Configure scheduled runs
- [ ] Knowledge transfer:
  - [ ] Write deployment guide
  - [ ] Record demo video
  - [ ] Train team on monitoring

### Deliverables
- [ ] Testnet environment fully operational
- [ ] 200 TPS sustained benchmark passing
- [ ] Production-ready Docker Compose setup
- [ ] Monitoring dashboard
- [ ] Complete documentation
- [ ] CI/CD pipeline for testnet

---

## 🚨 Risk Mitigation

### Risk 1: Testnet RPC Rate Limiting
**Mitigation**:
- [ ] Use multiple RPC endpoints
- [ ] Implement retry with exponential backoff
- [ ] Monitor RPC response times
- [ ] Have fallback RPC providers ready

### Risk 2: Testnet Token Shortage
**Mitigation**:
- [ ] Request testnet tokens early (50+ NEAR)
- [ ] Monitor balance regularly
- [ ] Use testnet faucet
- [ ] Consider using Pagoda console for bulk tokens

### Risk 3: Redis Downtime
**Mitigation**:
- [ ] Setup Redis replication (primary + 2 replicas)
- [ ] Enable persistence (RDB + AOF)
- [ ] Implement health checks
- [ ] Fallback to file-based queue if Redis down

### Risk 4: Nonce Conflicts Still Occurring
**Mitigation**:
- [ ] Increase nonce cache TTL
- [ ] Add distributed locks
- [ ] Implement nonce reservation system
- [ ] Monitor conflict rate continuously

---

## 📊 Success Metrics

### Milestone 1: Testnet Baseline (Week 2)
- [ ] Service running on testnet
- [ ] 50+ TPS sustained
- [ ] Success rate >80%
- [ ] Zero crashes

### Milestone 2: Redis Implementation (Week 4)
- [ ] Redis queue operational
- [ ] Nonce coordinator working
- [ ] 80-100 TPS sustained
- [ ] Success rate >90%
- [ ] Nonce conflicts <5%

### Milestone 3: Horizontal Scaling (Week 6)
- [ ] 4 API instances running
- [ ] Load balancer operational
- [ ] 150-180 TPS sustained
- [ ] Success rate >92%
- [ ] P95 latency <6s

### Milestone 4: Production Ready (Week 8)
- [ ] 200+ TPS sustained for 10 minutes
- [ ] Success rate >95%
- [ ] P95 latency <5s
- [ ] P99 latency <10s
- [ ] Zero ETIMEDOUT errors
- [ ] Monitoring dashboard live
- [ ] Documentation complete

---

## 📞 Daily Standup Template

**Date**: _______

### Yesterday
- [ ] Completed: _______________________________
- [ ] Blockers: _______________________________

### Today
- [ ] Working on: _______________________________
- [ ] Need help with: _______________________________

### Metrics
- Current TPS: _______
- Success rate: _______
- P95 latency: _______
- Blockers: _______

---

## 🎓 Knowledge Base

### Useful Commands
```bash
# Check testnet balance
near view-state ft-benchmark.testnet --finality final

# Monitor Redis
redis-cli INFO stats | grep instantaneous_ops_per_sec

# Watch live TPS
watch -n 1 'curl -s http://localhost:8000/metrics/jobs | jq ".tps"'

# Tail all service logs
docker-compose logs -f --tail=100

# Generate benchmark report
node scripts/report-benchmark.mjs testing/artillery/results-latest.json
```

### Troubleshooting Quick Reference
- High ETIMEDOUT → Reduce arrival rate
- Nonce conflicts → Check coordinator logs
- Redis connection errors → Verify REDIS_URL
- Low TPS → Check RPC latency, increase batch size
- High memory → Reduce queue size, check for leaks

---

*Checklist created to track progress toward 200 TPS target. Update daily and commit changes.*
