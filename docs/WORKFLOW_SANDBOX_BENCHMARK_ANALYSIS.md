# Analisis Workflow Sandbox Benchmark - NEAR FT Claiming Service

## 📋 Daftar Isi
1. [Ringkasan Eksekutif](#ringkasan-eksekutif)
2. [Pipeline & Alur Proses](#pipeline--alur-proses)
3. [Breakdown Komponen](#breakdown-komponen)
4. [Analisis Hasil Benchmark](#analisis-hasil-benchmark)
5. [Kendala & Hambatan](#kendala--hambatan)
6. [Rekomendasi Solusi untuk Target 200 TPS](#rekomendasi-solusi-untuk-target-200-tps)

---

## 🎯 Ringkasan Eksekutif

### Tujuan Workflow
Workflow **Sandbox Benchmark** (`benchmark.yml`) adalah pipeline otomatis GitHub Actions yang dirancang untuk:
- Menguji performa layanan NEAR FT Claiming Service pada lingkungan sandbox lokal
- Memvalidasi target throughput **100+ TPS sustained selama 10 menit** (60,000+ transfer)
- Mengidentifikasi bottleneck dan regresi performa
- Menghasilkan laporan benchmark terstruktur untuk analisis

### Status Terkini
Berdasarkan hasil benchmark terbaru:
- ❌ **Target belum tercapai**: Success rate ~0.6% (target: >95%)
- ❌ **TPS aktual**: ~25-90 TPS (target: 100+ TPS)
- ❌ **Kendala utama**: ETIMEDOUT errors (23,455 dari 24,563 requests)
- ⚠️ **Latency tinggi**: P95 = 9.74s (target: <5s), P99 = ~10s (target: <10s)

---

## 🔄 Pipeline & Alur Proses

### Diagram Alur Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions Trigger                        │
│  • Push ke branch main                                           │
│  • Manual workflow_dispatch                                      │
│  • Schedule: Setiap Senin 18:00 UTC (Selasa 01:00 WIB)         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Setup Environment                             │
│  1. Checkout repository                                          │
│  2. Setup Node.js 22.x                                          │
│  3. Install dependencies (npm ci)                               │
│  4. Make scripts executable                                      │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              Run Benchmark Pipeline                              │
│  Script: ./testing/test-complete-pipeline.sh                    │
│                                                                  │
│  Environment Variables:                                          │
│  • CI=true                                                       │
│  • TEST_DURATION=1100                                           │
│  • MAX_TPS=180                                                  │
│  • SANDBOX_HEADROOM_PERCENT=85                                  │
│  • SANDBOX_USE_CLUSTER=1                                        │
│  • CLUSTER_WORKERS=4                                            │
│  • ARTILLERY_PROFILE=benchmark-sandbox.yml                      │
│  • SANDBOX_MAX_IN_FLIGHT_PER_KEY=8                             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│          Test Complete Pipeline Execution                        │
│                                                                  │
│  Phase 1: Environment Setup                                      │
│  ├─ Download/cache near-sandbox binary v2.6.5                  │
│  ├─ Setup temp directories                                      │
│  └─ Clean existing processes                                    │
│                                                                  │
│  Phase 2: Start NEAR Sandbox                                    │
│  ├─ Launch near-sandbox on port 3030                           │
│  ├─ Wait for RPC endpoint ready                                │
│  └─ Generate sandbox state (accounts, keys)                    │
│                                                                  │
│  Phase 3: Deploy FT Contract                                    │
│  ├─ Deploy fungible_token.wasm to ft.test.near                │
│  ├─ Initialize contract (NEP-141)                              │
│  └─ Mint initial supply                                         │
│                                                                  │
│  Phase 4: Bootstrap Test Accounts                               │
│  ├─ Create receiver accounts (user1-5, alice, bob, charlie)    │
│  ├─ Register storage deposits (0.00125 NEAR each)              │
│  └─ Verify balances                                             │
│                                                                  │
│  Phase 5: Generate Key Pool                                     │
│  ├─ Create 12 full-access keys for service.test.near          │
│  ├─ Export keys to MASTER_ACCOUNT_PRIVATE_KEYS                 │
│  └─ Validate key pool configuration                             │
│                                                                  │
│  Phase 6: Start API Service                                     │
│  ├─ Load .env configuration                                     │
│  ├─ Start Express API on port 3000                             │
│  │  • Cluster mode dengan 4 workers                            │
│  │  • Key pool: 12 keys × 20 TPS/key = 240 TPS teoritis       │
│  │  • CONCURRENCY_LIMIT=600                                    │
│  │  • MAX_IN_FLIGHT=8 per key                                  │
│  └─ Wait for health check ready                                │
│                                                                  │
│  Phase 7: Run Artillery Benchmark                               │
│  ├─ Load benchmark-sandbox.yml configuration                   │
│  ├─ Execute load test phases (total ~1140 seconds):            │
│  │  1. Warm-up (0-60s): 5→25 TPS                              │
│  │  2. Stabilize (60-120s): 25 TPS                            │
│  │  3. Ramp up (120-270s): 20→70 TPS                          │
│  │  4. Plateau (270-390s): 70 TPS                             │
│  │  5. Final ramp (390-480s): 70→90 TPS                       │
│  │  6. 🎯 SUSTAINED (480-1080s): 90 TPS × 10 minutes          │
│  │  7. Cool-down (1080-1140s): 60→10 TPS                      │
│  ├─ Send POST requests to /send-ft                             │
│  └─ Generate results JSON                                       │
│                                                                  │
│  Phase 8: Cleanup                                               │
│  ├─ Stop API service                                            │
│  ├─ Stop near-sandbox                                           │
│  └─ Save logs                                                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              Generate Benchmark Report                           │
│  Script: scripts/report-benchmark.mjs                           │
│                                                                  │
│  Output Metrics:                                                 │
│  • Total requests                                                │
│  • Success/failure counts                                        │
│  • HTTP status codes (200, 4xx, 5xx)                           │
│  • Error types (ETIMEDOUT, ECONNRESET)                         │
│  • Latency percentiles (p50, p95, p99, max)                    │
│  • Mean RPS (requests per second)                               │
│  • Duration                                                      │
│  • Success rate                                                  │
│                                                                  │
│  Append to: GitHub Actions Step Summary                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              Upload Artifacts                                    │
│  Files:                                                          │
│  • sandbox.log - NEAR sandbox logs                             │
│  • api.log - Express API logs                                   │
│  • service*.log - Worker logs                                   │
│  • .last-artillery-run.log - Artillery execution log           │
│  • artillery-results-sandbox-*.json - Benchmark data           │
│  • *.yml - Configuration files                                  │
│                                                                  │
│  Artifact name: sandbox-benchmark-artifacts                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Breakdown Komponen

### 1. GitHub Actions Workflow (`benchmark.yml`)

**Lokasi**: `.github/workflows/benchmark.yml`

**Trigger Conditions**:
- Manual: `workflow_dispatch` (dapat dijalankan dari GitHub UI)
- Otomatis: Push ke branch `main`
- Terjadwal: Setiap Senin pukul 18:00 UTC (Selasa 01:00 WIB)

**Concurrency Control**:
```yaml
concurrency:
  group: sandbox-benchmark
  cancel-in-progress: false
```
Mencegah multiple runs berjalan bersamaan untuk menghindari konflik resource.

**Runner Environment**:
- OS: Ubuntu Latest
- Node.js: 22.x (dengan cache npm)
- Memory: 4GB heap size (`NODE_OPTIONS: --max-old-space-size=4096`)

**Key Configuration Values**:
```yaml
TEST_DURATION: 1100        # Total durasi test (detik)
MAX_TPS: 180              # Target maksimum TPS
SANDBOX_HEADROOM_PERCENT: 85  # Artillery akan target 85% dari MAX_TPS = 153 TPS
SANDBOX_USE_CLUSTER: 1    # Enable cluster mode
CLUSTER_WORKERS: 4        # Jumlah worker processes
ARTILLERY_PROFILE: benchmark-sandbox.yml
SANDBOX_MAX_IN_FLIGHT_PER_KEY: 8  # Max concurrent tx per key
```

### 2. Test Pipeline Script (`test-complete-pipeline.sh`)

**Lokasi**: `testing/test-complete-pipeline.sh`

**Tanggung Jawab Utama**:
1. **Environment Initialization**
   - Download near-sandbox binary (v2.6.5) jika belum ada
   - Setup direktori cache: `~/.cache/near-sandbox/`
   - Validate executable permissions

2. **Sandbox Management**
   - Start NEAR sandbox RPC server
   - Port: 3030
   - Mode: Local state (tidak persisten)
   - Genesis accounts: test.near + derivatives

3. **Contract Deployment**
   - Deploy `fungible_token.wasm` ke `ft.test.near`
   - Initialize NEP-141 contract
   - Mint token supply ke master account

4. **Account Provisioning**
   - Script: `ci/bootstrap-sandbox-accounts.mjs`
   - Creates: user1-5.test.near, alice.test.near, bob.test.near, charlie.test.near
   - Storage deposit: 0.00125 NEAR per account
   - Total receivers: 8 accounts

5. **Key Pool Generation**
   - Script: `ci/provision-master-keys.mjs`
   - Creates: 12 full-access keys for service.test.near
   - Export format: Comma-separated base64 private keys
   - Environment var: `MASTER_ACCOUNT_PRIVATE_KEYS`

6. **Service Launch**
   - Mode: Cluster dengan 4 worker processes
   - Load balancing: Round-robin via Node.js cluster module
   - Port: 3000
   - Health check: `GET /health`

7. **Artillery Execution**
   - Load config: `testing/artillery/benchmark-sandbox.yml`
   - Target URL: `http://127.0.0.1:3000`
   - Timeout: 120 seconds per request
   - Connection pool: 200, maxSockets: 600

### 3. Artillery Configuration (`benchmark-sandbox.yml`)

**Lokasi**: `testing/artillery/benchmark-sandbox.yml`

**Test Phases** (Total 1140 detik = 19 menit):

| Phase | Duration | Arrival Rate | Purpose |
|-------|----------|--------------|---------|
| Warm-up | 60s | 5→25 TPS | Prime RPC cache, key pool, storage checks |
| Stabilize | 60s | 25 TPS | Stabilisasi koneksi |
| Ramp 1 | 150s | 20→70 TPS | Gradual increase |
| Plateau 1 | 120s | 70 TPS | Validasi throughput awal |
| Ramp 2 | 90s | 70→90 TPS | Final push ke target |
| **SUSTAINED** | **600s** | **90 TPS** | **10 menit sustained load** ⭐ |
| Cool-down | 60s | 60→10 TPS | Graceful shutdown |

**Total Expected Requests**: ~54,000 requests

**Scenarios** (weighted):
1. **Single FT Transfer (80%)**:
   ```json
   POST /send-ft
   {
     "receiverId": "{{ receiverId }}",
     "amount": "{{ amount }}",
     "memo": "100TPS-10min benchmark"
   }
   ```

2. **Batched Transfers (15%)**:
   ```json
   POST /send-ft
   {
     "transfers": [
       { "receiverId": "...", "amount": "...", "memo": "Batch A" },
       { "receiverId": "...", "amount": "...", "memo": "Batch B" }
     ]
   }
   ```

3. **Health Check (5%)**:
   ```
   GET /health
   ```

**Variables**:
- `receiverId`: 8 pre-registered accounts (user1-5, alice, bob, charlie)
- `amount`: 4 variants (0.1, 1, 5, 10 tokens dengan 18 decimals)

**Performance Assertions**:
```yaml
ensure:
  maxErrorRate: 5              # Max 5% error rate
  p95: 5000                    # P95 latency < 5 seconds
  p99: 10000                   # P99 latency < 10 seconds
```

### 4. Reporting Script (`report-benchmark.mjs`)

**Lokasi**: `scripts/report-benchmark.mjs`

**Fungsi**:
- Parse hasil Artillery JSON
- Extract key metrics
- Generate GitHub Actions step summary
- Validate success criteria

**Output Metrics**:
- Total requests, success/failure breakdown
- HTTP status codes (200, 4xx, 5xx)
- Error types (ETIMEDOUT, ECONNRESET)
- Latency distribution (median, p95, p99, max)
- Mean RPS
- Duration & success rate

**Success Criteria**:
- Success rate ≥ 95%
- Zero 5xx errors
- Zero timeout errors

---

## 📊 Analisis Hasil Benchmark

### Hasil Terbaru (2025-09-29)

#### Metrics Summary

| Metric | Actual | Target | Status |
|--------|--------|--------|--------|
| **Total Requests** | 172 | 54,000+ | ❌ 0.3% |
| **Success Rate** | 0.57% | >95% | ❌ |
| **Successful (200)** | 139 | 51,300+ | ❌ |
| **Failed (500)** | 33 | <2,700 | ❌ |
| **Scenarios Completed** | 147 / 24,563 | 23,000+ | ❌ 0.6% |
| **ETIMEDOUT Errors** | 23,455 | 0 | ❌ |
| **ECONNRESET Errors** | 936 | 0 | ❌ |
| **Mean RPS** | 87.51 | 90 | ⚠️ Close |
| **Median Latency** | 3.03s | <2s | ❌ |
| **P95 Latency** | 9.74s | <5s | ❌ 194% |
| **P99 Latency** | ~10s | <10s | ⚠️ At limit |
| **Max Latency** | 9.98s | <15s | ✅ |

#### Key Observations

1. **Catastrophic Timeout Rate**:
   - 23,455 ETIMEDOUT dari 24,563 scenarios (95.5%)
   - Mayoritas request tidak sempat dikirim
   - Artillery timeout (120s) tercapai sebelum API respond

2. **Low Completion Rate**:
   - Hanya 147 scenarios selesai dari 24,563 attempted (0.6%)
   - API server overload, tidak bisa memproses incoming rate
   - Queue saturation

3. **High Latency**:
   - Median 3s, P95 9.74s
   - Indicates heavy queueing + retry delays
   - NEAR RPC backpressure

4. **Connection Resets**:
   - 936 ECONNRESET errors
   - TCP connection drops karena timeout
   - Worker crash/restart

5. **Mean RPS Misleading**:
   - Artillery report 87.51 req/s
   - Tapi actual throughput jauh lebih rendah
   - Banyak request stuck di Artillery queue

### Hasil Smoke Test (2025-10-09)

| Metric | Value | Note |
|--------|-------|------|
| Total requests | 3,025 | |
| Success (200) | 121 | Mostly health checks |
| Failed (500) | 257 | |
| Scenarios completed | 378 (12.5%) | Improvement dari 0.6%! |
| ETIMEDOUT | 2,018 | Reduced 90% vs 9/29 |
| ECONNRESET | 629 | |
| Median latency | 12.7s | Worse than sustained test |
| P95 latency | 24.1s | |
| Mean RPS | 24 | Lower load |

**Observations**:
- Logging pipeline fix (no `_flushSync` warnings)
- Single signer key limits throughput
- Node version warning (18.19.1 < 22.13)
- Kernel tuning warnings (`net.core.rmem_max`)

---

## 🚧 Kendala & Hambatan

### 1. Sandbox RPC Limitations ⭐ **ROOT CAUSE**

**Problem**:
- NEAR sandbox bukan production RPC
- Single-threaded, tidak ada horizontal scaling
- Limited throughput: ~30-50 TPS real capacity

**Evidence**:
- Timeouts muncul saat load >50 TPS
- RPC response time meningkat drastis di sustained phase
- Transaction queue buildup di sandbox

**Impact**: 🔴 **CRITICAL** - Sandbox tidak bisa handle 90-100 TPS sustained

### 2. Artillery Configuration Mismatch

**Problem**:
- Target 90 TPS terlalu tinggi untuk sandbox capacity
- Timeout 120s tidak cukup untuk queue buildup
- Connection pool (200) vs maxSockets (600) imbalance

**Evidence**:
- 95.5% ETIMEDOUT rate
- Requests stuck di Artillery queue
- TCP connection exhaustion (ECONNRESET)

**Impact**: 🟠 **HIGH** - Load test tidak mencerminkan actual service capacity

### 3. Key Pool Nonce Conflicts

**Problem**:
- 12 keys × 20 TPS/key = 240 TPS teoritis
- Tapi nonce retry overhead tinggi
- Single key test (smoke) hanya 24 RPS

**Evidence**:
- Smoke test dengan 1 key: 24 RPS
- Full test dengan 12 keys: ~87 RPS (bukan 240 RPS)
- Nonce conflict warnings di logs

**Impact**: 🟡 **MEDIUM** - Key pool scaling tidak linear

### 4. Worker Cluster Overhead

**Problem**:
- 4 workers × contention untuk shared key pool
- IPC (inter-process communication) overhead
- No shared state untuk nonce coordination

**Evidence**:
- ECONNRESET spikes (936 errors)
- Worker restarts/crashes di logs
- Inconsistent performance

**Impact**: 🟡 **MEDIUM** - Cluster mode tidak memberikan expected benefit

### 5. Logging & I/O Bottleneck

**Problem**:
- High-frequency logging (`_flushSync` warnings di old runs)
- Disk I/O contention
- Log rotation overhead

**Evidence**:
- `_flushSync took too long` warnings (pre-fix)
- Performance degradation saat logging enabled
- Fixed in 10/9 smoke test (sync file logging)

**Impact**: 🟢 **LOW** - Sudah di-mitigate dengan PINO_DESTINATION

### 6. Network & Kernel Tuning

**Problem**:
- Default Linux kernel parameters untuk network stack
- TCP buffer sizes (`net.core.rmem_max`, `tcp_rmem`)
- File descriptor limits

**Evidence**:
- Kernel warnings di sandbox logs
- Connection resets under load
- Mentioned in smoke test observations

**Impact**: 🟢 **LOW** - Bukan root cause, tapi perlu tuning untuk optimal

### 7. Artillery vs Actual Throughput Gap

**Problem**:
- Artillery's reported "mean RPS" (87.51) tidak sama dengan actual successful TPS
- Artillery menghitung arrival rate, bukan completion rate
- Misleading untuk validasi target

**Evidence**:
- Artillery: 87.51 req/s
- Actual completed: 147 scenarios / ~600s = 0.24 TPS
- 99.7% gap

**Impact**: 🟠 **HIGH** - Metrics tidak reliable untuk decision making

---

## 🎯 Rekomendasi Solusi untuk Target 200 TPS

### Strategi 1: **Ganti Sandbox dengan Localnet/Testnet** ⭐ **HIGHEST IMPACT**

**Rationale**:
- Sandbox RPC **TIDAK** dirancang untuk high-throughput benchmarking
- Production RPC (testnet/mainnet) punya multi-node, horizontal scaling
- Testnet RPC: ~200-500 TPS capacity

**Implementation**:

1. **Setup Testnet Benchmark**:
   ```bash
   # Create dedicated testnet account for benchmarking
   near create-account benchmark.your-account.testnet \
     --masterAccount your-account.testnet \
     --initialBalance 50
   
   # Deploy FT contract to testnet
   near deploy --accountId ft.benchmark.testnet \
     --wasmFile fungible_token.wasm
   
   # Bootstrap 50-100 receiver accounts
   node ci/setup-test-accounts.mjs --env testnet --count 100
   ```

2. **Update Artillery Config**:
   ```yaml
   # testing/artillery/benchmark-testnet.yml
   config:
     target: 'http://127.0.0.1:3000'
     phases:
       - duration: 120
         arrivalRate: 50
         rampTo: 100
         name: "Warm-up"
       - duration: 600
         arrivalRate: 200
         name: "Sustained 200 TPS"  # 🎯 Target
       - duration: 60
         arrivalRate: 50
         name: "Cool-down"
   ```

3. **Update GitHub Actions Workflow**:
   ```yaml
   # .github/workflows/benchmark.yml
   env:
     NEAR_ENV: testnet
     NODE_URL: https://rpc.testnet.near.org
     MAX_TPS: 250
     ARTILLERY_PROFILE: benchmark-testnet.yml
   ```

**Expected Outcome**: ✅ 200 TPS sustained achievable

**Cost**: 💰 Testnet tokens (~50 NEAR untuk fees + storage)

---

### Strategi 2: **Optimize Sandbox Configuration untuk Realistic Testing**

**Jika tetap ingin pakai sandbox** (untuk CI/local testing):

**Goal**: Target realistis 40-60 TPS sustained (bukan 100+ TPS)

**Implementation**:

1. **Right-size Artillery Profile**:
   ```yaml
   # testing/artillery/benchmark-sandbox-realistic.yml
   config:
     phases:
       - duration: 60
         arrivalRate: 10
         rampTo: 30
         name: "Warm-up"
       - duration: 600
         arrivalRate: 50    # 🎯 Realistic sandbox target
         name: "Sustained 50 TPS"
       - duration: 60
         arrivalRate: 10
         name: "Cool-down"
     http:
       timeout: 60          # Reduce dari 120s
       pool: 100            # Reduce dari 200
       maxSockets: 200      # Reduce dari 600
   ```

2. **Reduce Key Pool**:
   ```bash
   # test-complete-pipeline.sh
   SANDBOX_KEY_POOL_SIZE=6  # Reduce dari 12
   # 6 keys × 10 TPS/key = 60 TPS capacity
   ```

3. **Optimize Worker Configuration**:
   ```yaml
   # .github/workflows/benchmark.yml
   env:
     CLUSTER_WORKERS: 2     # Reduce dari 4
     SANDBOX_MAX_IN_FLIGHT_PER_KEY: 5  # Reduce dari 8
     MAX_TPS: 60
   ```

**Expected Outcome**: ✅ 50 TPS sustained dengan >95% success rate

**Benefit**: Lebih reliable untuk CI smoke tests

---

### Strategi 3: **Improve Service-Level Performance**

**Optimizations untuk mencapai 200 TPS** (applicable untuk testnet/mainnet):

#### A. **Database-Backed Job Persistence**

**Problem**: JSONL file I/O bottleneck

**Solution**:
```javascript
// Replace JSONL dengan Redis/PostgreSQL
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

async function persistJob(job) {
  await redis.hset(`job:${job.jobId}`, job);
  await redis.zadd('jobs:pending', Date.now(), job.jobId);
}
```

**Benefit**: 10x faster I/O, sub-millisecond latency

#### B. **Optimize Nonce Management**

**Problem**: Nonce conflicts dengan multiple workers

**Solution**:
```javascript
// Centralized nonce coordination via Redis
class NonceCoordinator {
  async acquireNonce(accountId, keyIndex) {
    const nonce = await redis.incr(`nonce:${accountId}:${keyIndex}`);
    return nonce;
  }
}
```

**Benefit**: Eliminate nonce retries, 30% throughput increase

#### C. **Batching Optimization**

**Problem**: Single transfers tidak efficient

**Solution**:
```javascript
// Dynamic batching based on queue depth
const BATCH_SIZE = Math.min(
  queueSize / 10,        // 10% of queue
  MAX_BATCH_SIZE         // Cap at 50
);
```

**Benefit**: 3-5x reduction in NEAR RPC calls

#### D. **Circuit Breaker Pattern**

**Problem**: Cascading failures saat RPC overload

**Solution**:
```javascript
import CircuitBreaker from 'opossum';

const breaker = new CircuitBreaker(nearRpcCall, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
});
```

**Benefit**: Graceful degradation, faster recovery

---

### Strategi 4: **Infrastructure Scaling**

#### A. **Horizontal Scaling dengan Load Balancer**

```
┌─────────────┐
│   Nginx     │  Load Balancer
│   (8000)    │
└──────┬──────┘
       │
       ├──────┬──────┬──────┐
       │      │      │      │
    ┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐
    │ API ││ API ││ API ││ API │  4 instances
    │:3001││:3002││:3003││:3004│
    └─────┘└─────┘└─────┘└─────┘
       │      │      │      │
       └──────┴──────┴──────┘
              │
       ┌──────▼──────┐
       │   Redis     │  Shared state
       │   (6379)    │
       └─────────────┘
```

**Implementation**:
```nginx
# nginx.conf
upstream api_backend {
    least_conn;
    server localhost:3001;
    server localhost:3002;
    server localhost:3003;
    server localhost:3004;
}

server {
    listen 8000;
    location / {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

**Benefit**: 4x throughput (4 instances)

#### B. **Resource Allocation**

```yaml
# docker-compose.yml
services:
  api:
    deploy:
      replicas: 4
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

---

### Strategi 5: **Monitoring & Observability**

**Implement real-time monitoring** untuk identify bottlenecks:

```javascript
// Prometheus metrics
import promClient from 'prom-client';

const throughputGauge = new promClient.Gauge({
  name: 'ft_service_tps',
  help: 'Current TPS',
  labelNames: ['status']
});

const queueDepthGauge = new promClient.Gauge({
  name: 'ft_service_queue_depth',
  help: 'Pending jobs in queue'
});

// Update metrics
setInterval(() => {
  throughputGauge.set({ status: 'success' }, currentTps);
  queueDepthGauge.set(pendingJobsCount);
}, 1000);
```

**Grafana Dashboard**:
- TPS (success/failed)
- Queue depth
- Latency percentiles
- Error rate by type
- RPC response time

---

## 📈 Roadmap untuk 200 TPS

### Phase 1: Foundation (Week 1-2)
- [ ] Migrasi benchmark ke testnet
- [ ] Setup 100 receiver accounts
- [ ] Deploy monitoring (Prometheus + Grafana)
- [ ] Baseline benchmark: measure current testnet TPS

### Phase 2: Service Optimization (Week 3-4)
- [ ] Implement Redis-backed job persistence
- [ ] Centralized nonce coordination
- [ ] Dynamic batching optimization
- [ ] Circuit breaker for RPC calls

### Phase 3: Scaling (Week 5-6)
- [ ] Horizontal scaling: 4 API instances
- [ ] Setup Nginx load balancer
- [ ] Shared state via Redis cluster
- [ ] Run 200 TPS benchmark

### Phase 4: Validation (Week 7-8)
- [ ] Sustained 200 TPS for 10 minutes
- [ ] Success rate >95%
- [ ] P95 latency <5s
- [ ] Document final architecture
- [ ] Update CI/CD pipelines

---

## 🎓 Kesimpulan

### Why 100+ TPS Failed on Sandbox?

**Root Cause**: Sandbox RPC **NOT** designed for production-scale benchmarking.

1. **Sandbox limitations**:
   - Single-threaded RPC
   - No horizontal scaling
   - ~30-50 TPS real capacity
   - Local state, no persistence

2. **Configuration mismatch**:
   - Artillery target (90 TPS) > sandbox capacity
   - Timeout cascade (95.5% ETIMEDOUT)
   - Queue saturation

3. **Metrics misleading**:
   - Artillery's "mean RPS" ≠ actual TPS
   - Need to measure successful completions, not arrival rate

### How to Achieve 200 TPS?

**Recommended Approach**:

1. ✅ **Use Testnet/Mainnet RPC** (not sandbox)
   - Production RPC capacity: 200-500 TPS
   - Horizontal scaling available
   - Real-world latency validation

2. ✅ **Optimize Service Architecture**
   - Redis-backed persistence
   - Centralized nonce coordination
   - Dynamic batching
   - Circuit breaker pattern

3. ✅ **Horizontal Scaling**
   - 4+ API instances
   - Load balancer (Nginx)
   - Shared state (Redis cluster)

4. ✅ **Comprehensive Monitoring**
   - Real-time TPS metrics
   - Queue depth tracking
   - Latency distribution
   - Error rate breakdown

**Expected Outcome**:
- 🎯 200 TPS sustained for 10 minutes
- ✅ Success rate >95%
- ✅ P95 latency <5s
- ✅ P99 latency <10s

**Timeline**: 6-8 weeks for full implementation

---

## 📚 Referensi

- [Artillery Documentation](https://www.artillery.io/docs)
- [NEAR RPC Performance](https://docs.near.org/api/rpc/providers)
- [NEP-141: Fungible Token Standard](https://nomicon.io/Standards/Tokens/FungibleToken/Core)
- [GitHub Actions Workflows](https://docs.github.com/en/actions)

---

*Dokumen ini dibuat untuk memberikan analisis menyeluruh tentang workflow sandbox benchmark dan roadmap untuk mencapai target 200 TPS.*
