# Quick Reference: Sandbox Benchmark Workflow

## 🚀 Cara Menjalankan Benchmark

### Manual Run (Local)

```bash
# 1. Persiapan
cd near-ft-claim-service
npm install

# 2. Jalankan benchmark lengkap
./testing/test-complete-pipeline.sh

# 3. Atau gunakan profile spesifik
ARTILLERY_PROFILE=benchmark-sandbox.yml ./testing/test-complete-pipeline.sh
```

### GitHub Actions (Automated)

```bash
# Manual trigger dari GitHub UI:
1. Buka: https://github.com/Psianturi/near-ft-claim-service/actions/workflows/benchmark.yml
2. Klik: "Run workflow"
3. Pilih branch: main
4. Klik: "Run workflow"

# Atau via CLI:
gh workflow run benchmark.yml
```

---

## 📊 Membaca Hasil Benchmark

### Key Metrics yang Harus Diperhatikan

#### ✅ SUCCESS INDICATORS
```
Total Requests:      60,000+     ← Harus mencapai target
Success Rate:        >95%        ← Critical!
Mean TPS:            100+        ← Target throughput
ETIMEDOUT errors:    0           ← Harus zero
P95 Latency:         <5s         ← 95% request finish dalam 5 detik
P99 Latency:         <10s        ← 99% request finish dalam 10 detik
```

#### ❌ FAILURE INDICATORS
```
Success Rate:        <50%        ← Red flag
ETIMEDOUT:           >1000       ← RPC/API overload
ECONNRESET:          >500        ← Connection issues
P95 Latency:         >10s        ← Severe queueing
5xx errors:          >100        ← Server errors
```

### Contoh Hasil BAIK
```markdown
| Metric | Value |
|--------|-------|
| Total requests | 60,234 |
| Successful (200) | 58,123 |
| Success rate | 96.50% |  ✅
| ETIMEDOUT errors | 0 |      ✅
| Mean RPS | 100.4 |           ✅
| p95 latency (ms) | 4,230 |   ✅
```

### Contoh Hasil GAGAL
```markdown
| Metric | Value |
|--------|-------|
| Total requests | 172 |
| Successful (200) | 139 |
| Success rate | 0.57% |        ❌
| ETIMEDOUT errors | 23,455 |   ❌
| Mean RPS | 87.51 |            ⚠️
| p95 latency (ms) | 9,740 |    ❌
```

---

## 🔍 Troubleshooting Common Issues

### Issue 1: High ETIMEDOUT Rate (>90%)

**Symptoms**:
```
ETIMEDOUT errors: 23,455
Success rate: <5%
Scenarios completed: <1%
```

**Root Cause**: Sandbox RPC overload

**Solutions**:
1. **Reduce target TPS**:
   ```bash
   MAX_TPS=50 ./testing/test-complete-pipeline.sh
   ```

2. **Use realistic Artillery profile**:
   ```bash
   ARTILLERY_PROFILE=benchmark-sandbox-optimized.yml \
   ./testing/test-complete-pipeline.sh
   ```

3. **Migrate to testnet** (recommended):
   ```bash
   NEAR_ENV=testnet \
   NODE_URL=https://rpc.testnet.near.org \
   ./testing/test-complete-pipeline.sh
   ```

### Issue 2: Nonce Conflicts

**Symptoms**:
```
Logs: "Nonce conflict detected, retrying..."
Latency: High (>5s)
Failed transactions: 10-20%
```

**Root Cause**: Multiple workers using same key

**Solutions**:
1. **Reduce cluster workers**:
   ```bash
   CLUSTER_WORKERS=2 ./testing/test-complete-pipeline.sh
   ```

2. **Increase key pool**:
   ```bash
   SANDBOX_KEY_POOL_SIZE=12 ./testing/test-complete-pipeline.sh
   ```

3. **Implement nonce coordinator** (best):
   ```typescript
   // Use Redis-based coordination
   const coordinator = new NonceCoordinator(redisUrl);
   ```

### Issue 3: Queue Saturation

**Symptoms**:
```
Queue depth: >10,000
Memory usage: High
Processing rate: Slow
```

**Root Cause**: Incoming rate > processing rate

**Solutions**:
1. **Lower arrival rate**:
   ```yaml
   # benchmark-sandbox.yml
   phases:
     - duration: 600
       arrivalRate: 50  # Reduce from 90
   ```

2. **Increase workers**:
   ```bash
   CLUSTER_WORKERS=4 ./testing/test-complete-pipeline.sh
   ```

3. **Optimize batching**:
   ```javascript
   BATCH_SIZE_MIN=10
   BATCH_SIZE_MAX=30
   ```

---

## 🎯 Configuration Quick Reference

### Environment Variables

#### Performance Tuning
```bash
MAX_TPS=180                    # Global TPS limit
CONCURRENCY_LIMIT=600          # Max concurrent requests
MAX_IN_FLIGHT_PER_KEY=8        # Max tx per key
BATCH_SIZE_MIN=5               # Min batch size
BATCH_SIZE_MAX=50              # Max batch size
```

#### Cluster Configuration
```bash
SANDBOX_USE_CLUSTER=1          # Enable cluster mode
CLUSTER_WORKERS=4              # Number of workers
```

#### Key Pool
```bash
SANDBOX_KEY_POOL_SIZE=12       # Number of keys to generate
MASTER_ACCOUNT_PRIVATE_KEYS=   # Comma-separated base64 keys
```

#### Artillery
```bash
ARTILLERY_PROFILE=benchmark-sandbox.yml
TEST_DURATION=600              # Sustained phase duration
SANDBOX_HEADROOM_PERCENT=85    # % of MAX_TPS to target
```

### Artillery Profiles

| Profile | Target TPS | Duration | Use Case |
|---------|-----------|----------|----------|
| `benchmark-sandbox-smoke.yml` | 40 | 2 min | Quick validation |
| `benchmark-sandbox.yml` | 90 | 10 min | Full benchmark |
| `benchmark-sandbox-optimized.yml` | 50 | 10 min | Realistic sandbox |
| `benchmark-testnet.yml` | 200 | 10 min | Production target |

---

## 📈 Performance Targets

### Current Status (2025-09-29)
```
┌─────────────────────┬──────────┬──────────┬────────────┐
│ Metric              │ Current  │ Target   │ Status     │
├─────────────────────┼──────────┼──────────┼────────────┤
│ TPS                 │ 0.24     │ 100      │ ❌ 0.24%  │
│ Success Rate        │ 0.57%    │ >95%     │ ❌         │
│ P95 Latency         │ 9.74s    │ <5s      │ ❌ 194%   │
│ ETIMEDOUT           │ 23,455   │ 0        │ ❌         │
└─────────────────────┴──────────┴──────────┴────────────┘
```

### Sandbox Optimized (Realistic)
```
┌─────────────────────┬──────────┬──────────┬────────────┐
│ Metric              │ Expected │ Target   │ Status     │
├─────────────────────┼──────────┼──────────┼────────────┤
│ TPS                 │ 50       │ 50       │ ✅ 100%   │
│ Success Rate        │ >90%     │ >90%     │ ✅         │
│ P95 Latency         │ <5s      │ <5s      │ ✅         │
│ ETIMEDOUT           │ <5%      │ <10%     │ ✅         │
└─────────────────────┴──────────┴──────────┴────────────┘
```

### Testnet (Production Target)
```
┌─────────────────────┬──────────┬──────────┬────────────┐
│ Metric              │ Expected │ Target   │ Status     │
├─────────────────────┼──────────┼──────────┼────────────┤
│ TPS                 │ 200      │ 200      │ ✅ 100%   │
│ Success Rate        │ >95%     │ >95%     │ ✅         │
│ P95 Latency         │ <5s      │ <5s      │ ✅         │
│ ETIMEDOUT           │ 0        │ 0        │ ✅         │
└─────────────────────┴──────────┴──────────┴────────────┘
```

---

## 🛠️ Quick Commands

### Run Benchmark Variants

```bash
# Smoke test (90 seconds, 40 TPS)
SANDBOX_SMOKE_TEST=1 ./testing/test-complete-pipeline.sh

# 10-minute sustained (90 TPS)
SANDBOX_BENCHMARK_10M=1 ./testing/test-complete-pipeline.sh

# Custom TPS
MAX_TPS=60 ./testing/test-complete-pipeline.sh

# Custom duration
TEST_DURATION=300 ./testing/test-complete-pipeline.sh

# Testnet benchmark
NEAR_ENV=testnet \
NODE_URL=https://rpc.testnet.near.org \
MAX_TPS=200 \
./testing/test-complete-pipeline.sh
```

### Check Results

```bash
# View latest Artillery results
cat testing/artillery/artillery-results-sandbox-*.json | jq '.aggregate'

# Generate summary report
node scripts/report-benchmark.mjs

# Check API metrics
curl http://localhost:3000/metrics/jobs

# View logs
tail -f service.log
tail -f sandbox.log
tail -f api.log
```

### Validate Configuration

```bash
# Check config validity
node scripts/validate-config.mjs --env sandbox

# Expected output:
# ✅ Key Pool Size: 12 keys (optimal)
# ✅ Concurrency Limit: 600 (optimal)
# ✅ Max In-Flight: 8 (optimal)
# ✅ Global Throttle: 180 TPS (sufficient)
#
# Estimated Max TPS: ~240 TPS
# ✅ Configuration should support 100+ TPS
```

---

## 📚 File Locations

### Configuration Files
```
.env                                    # Sandbox config
.env.testnet                            # Testnet config
testing/artillery/benchmark-sandbox.yml # Artillery config
testing/test-complete-pipeline.sh       # Main pipeline script
```

### Results & Logs
```
testing/artillery/artillery-results-sandbox-*.json  # Benchmark data
testing/artillery/artillery-report-sandbox-*.html   # HTML report
testing/artillery/.last-artillery-run.log           # Artillery logs
sandbox.log                                         # Sandbox RPC logs
api.log                                             # API server logs
service.log                                         # Worker logs
```

### Scripts
```
ci/bootstrap-sandbox-accounts.mjs      # Setup test accounts
ci/provision-master-keys.mjs           # Generate key pool
ci/deploy-sandbox-rpc.mjs              # Deploy contracts
scripts/validate-config.mjs            # Config validator
scripts/report-benchmark.mjs           # Results reporter
```

---

## 🎓 Learning Resources

### Internal Documentation
- [Main README](../README.md) - Overview & quick start
- [Workflow Analysis](./WORKFLOW_SANDBOX_BENCHMARK_ANALYSIS.md) - Deep dive
- [Bottleneck Analysis](./BENCHMARK_BOTTLENECK_ANALYSIS.md) - Performance insights
- [Testing Guide](./testing.md) - Test strategy
- [CI/CD Guide](./ci.md) - Automation details

### External Resources
- [Artillery Docs](https://www.artillery.io/docs)
- [NEAR Sandbox](https://docs.near.org/develop/testing/sandbox)
- [NEP-141: FT Standard](https://nomicon.io/Standards/Tokens/FungibleToken/Core)
- [NEAR RPC Endpoints](https://docs.near.org/api/rpc/providers)

---

## ❓ FAQ

### Q: Kenapa hasil benchmark menunjukkan 87 RPS tapi success rate 0.57%?

**A**: Artillery melaporkan **arrival rate** (request yang dikirim), bukan **completion rate** (request yang selesai). Mayoritas request timeout sebelum selesai.

---

### Q: Apakah 200 TPS achievable di sandbox?

**A**: **TIDAK**. Sandbox RPC capacity ~30-50 TPS. Untuk 200 TPS, gunakan testnet atau mainnet RPC.

---

### Q: Berapa biaya untuk mencapai 200 TPS?

**A**: 
- Testnet: **Gratis** (testnet tokens free)
- Infrastructure:
  - Redis Cloud: $20/month
  - 4 API instances: $40-80/month (DigitalOcean/AWS)
  - **Total: ~$60-100/month**

---

### Q: Berapa lama untuk implementasi 200 TPS?

**A**: 
- Path A (Testnet migration): **2 weeks**
- Path B (Full optimization): **6-8 weeks**
- Path C (Sandbox realistic): **1 week** (50-60 TPS)

---

### Q: Apa prioritas tertinggi untuk fix?

**A**: **Migrasi ke testnet**. Sandbox adalah bottleneck utama (root cause). Optimizations lainnya tidak akan membantu jika tetap pakai sandbox.

---

### Q: Bagaimana cara monitoring real-time?

**A**:
```bash
# Terminal 1: Watch metrics endpoint
watch -n 1 'curl -s http://localhost:3000/metrics/jobs | jq'

# Terminal 2: Watch logs
tail -f service.log | grep -E "(TPS|error|timeout)"

# Terminal 3: Artillery dashboard
npx artillery run benchmark-sandbox.yml --output results.json | \
  npx artillery-plugin-publish-metrics
```

---

*Quick reference untuk memahami dan troubleshoot sandbox benchmark workflow.*
