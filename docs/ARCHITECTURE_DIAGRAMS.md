# Architecture & Flow Diagrams - NEAR FT Benchmark

## 1. GitHub Actions Workflow Flow

```mermaid
graph TD
    A[Trigger: Push/Manual/Schedule] --> B[Setup Environment]
    B --> C[Checkout Code]
    C --> D[Setup Node.js 22.x]
    D --> E[Install Dependencies]
    E --> F[Make Scripts Executable]
    F --> G[Run test-complete-pipeline.sh]
    
    G --> H{Pipeline Execution}
    H --> H1[Download Sandbox Binary]
    H --> H2[Start NEAR Sandbox RPC]
    H --> H3[Deploy FT Contract]
    H --> H4[Bootstrap Accounts]
    H --> H5[Generate Key Pool]
    H --> H6[Start API Service]
    H --> H7[Run Artillery Benchmark]
    
    H7 --> I[Artillery Executes 7 Phases]
    I --> I1[Phase 1: Warm-up 60s]
    I --> I2[Phase 2: Stabilize 60s]
    I --> I3[Phase 3: Ramp 150s]
    I --> I4[Phase 4: Plateau 120s]
    I --> I5[Phase 5: Ramp 90s]
    I --> I6[Phase 6: SUSTAINED 600s]
    I --> I7[Phase 7: Cool-down 60s]
    
    I7 --> J[Generate Results JSON]
    J --> K[Run report-benchmark.mjs]
    K --> L[Upload Artifacts]
    L --> M[GitHub Actions Summary]
    
    style I6 fill:#ff6b6b,stroke:#c92a2a,stroke-width:3px
    style H7 fill:#ffd93d,stroke:#f59f00
    style M fill:#51cf66,stroke:#2f9e44
```

## 2. Request Flow Architecture

```mermaid
sequenceDiagram
    participant A as Artillery Load Generator
    participant LB as Nginx Load Balancer
    participant API1 as API Instance 1
    participant API2 as API Instance 2
    participant R as Redis Queue
    participant NC as Nonce Coordinator
    participant W as Worker Pool
    participant RPC as NEAR RPC

    A->>LB: POST /send-ft (200 TPS)
    LB->>API1: Route request
    LB->>API2: Route request
    
    API1->>R: Push job to queue
    API2->>R: Push job to queue
    
    R->>W: Pull pending jobs
    W->>NC: Acquire nonce
    NC->>NC: Atomic increment
    NC-->>W: Nonce value
    
    W->>W: Build & sign transaction
    W->>RPC: Submit transaction
    RPC-->>W: Transaction result
    
    W->>R: Update job status
    R-->>API1: Job completion
    API1-->>A: Response
```

## 3. Current Architecture (Failing)

```mermaid
graph LR
    A[Artillery 90 TPS] --> B[Node Cluster 4 workers]
    B --> C[JSONL File Queue]
    C --> D[Transaction Signer]
    D --> E[Sandbox RPC 30-50 TPS]
    
    B -.Bottleneck #1: Worker contention.-> B
    C -.Bottleneck #2: File I/O 10-50ms.-> C
    D -.Bottleneck #3: Nonce conflicts.-> D
    E -.Bottleneck #4: RPC capacity.-> E
    
    style E fill:#ff6b6b,stroke:#c92a2a,stroke-width:4px
    style A fill:#ffd93d,stroke:#f59f00
```

## 4. Target Architecture (200 TPS)

```mermaid
graph LR
    A[Artillery 200 TPS] --> B[Nginx Load Balancer]
    B --> C1[API Instance 1]
    B --> C2[API Instance 2]
    B --> C3[API Instance 3]
    B --> C4[API Instance 4]
    
    C1 --> D[Redis Cluster]
    C2 --> D
    C3 --> D
    C4 --> D
    
    D --> E[Nonce Coordinator]
    D --> F[Worker Pool]
    
    E --> F
    F --> G[Testnet RPC 200-500 TPS]
    
    style G fill:#51cf66,stroke:#2f9e44,stroke-width:3px
    style D fill:#4dabf7,stroke:#1971c2
    style A fill:#ffd93d,stroke:#f59f00
```

## 5. Bottleneck Impact Chart

```mermaid
pie title Throughput Loss Distribution
    "Sandbox RPC Capacity" : 60
    "Nonce Conflicts" : 20
    "File I/O (JSONL)" : 15
    "Worker Contention" : 5
```

## 6. Performance Timeline Comparison

```mermaid
gantt
    title Benchmark Performance Over Time
    dateFormat YYYY-MM-DD
    section Current State
    Baseline (0.24 TPS)           :milestone, 2025-09-29, 0d
    
    section Sandbox Optimized
    Config tuning                 :active, 2025-01-09, 7d
    Target achieved (50 TPS)      :milestone, 2025-01-16, 0d
    
    section Testnet Migration
    Setup testnet env             :2025-01-09, 14d
    Redis implementation          :2025-01-23, 7d
    Nonce coordination            :2025-01-30, 7d
    Baseline (80 TPS)             :milestone, 2025-02-06, 0d
    Horizontal scaling            :2025-02-06, 14d
    Target achieved (200 TPS)     :milestone, 2025-02-20, 0d
```

## 7. Deployment Architecture (Production)

```mermaid
graph TB
    subgraph "Load Balancer Layer"
        LB[Nginx :8000]
    end
    
    subgraph "API Layer"
        API1[API :3001]
        API2[API :3002]
        API3[API :3003]
        API4[API :3004]
    end
    
    subgraph "State Layer"
        R1[(Redis Primary)]
        R2[(Redis Replica 1)]
        R3[(Redis Replica 2)]
    end
    
    subgraph "NEAR Network"
        RPC1[RPC Node 1]
        RPC2[RPC Node 2]
        RPC3[RPC Node 3]
        RPCn[RPC Node N]
    end
    
    subgraph "Monitoring"
        P[Prometheus]
        G[Grafana]
    end
    
    LB --> API1
    LB --> API2
    LB --> API3
    LB --> API4
    
    API1 --> R1
    API2 --> R1
    API3 --> R1
    API4 --> R1
    
    R1 --> R2
    R1 --> R3
    
    API1 --> RPC1
    API2 --> RPC2
    API3 --> RPC3
    API4 --> RPCn
    
    API1 --> P
    API2 --> P
    API3 --> P
    API4 --> P
    P --> G
    
    style LB fill:#339af0,stroke:#1971c2
    style R1 fill:#ff6b6b,stroke:#c92a2a
    style P fill:#51cf66,stroke:#2f9e44
```

## 8. Data Flow Diagram

```mermaid
flowchart TD
    Start([Client Request]) --> Validate{Valid Request?}
    Validate -->|No| Error[Return 400 Error]
    Validate -->|Yes| CreateJob[Create Job Record]
    
    CreateJob --> PushQueue[Push to Redis Queue]
    PushQueue --> WaitWorker[Wait for Worker]
    
    WaitWorker --> PullJob[Worker Pulls Job]
    PullJob --> AcquireNonce[Acquire Nonce from Coordinator]
    AcquireNonce --> BuildTx[Build Transaction]
    BuildTx --> SignTx[Sign with Private Key]
    SignTx --> SubmitTx[Submit to NEAR RPC]
    
    SubmitTx --> CheckResult{Success?}
    CheckResult -->|Yes| UpdateSuccess[Update Status: Submitted]
    CheckResult -->|No| CheckRetry{Retries < Max?}
    
    CheckRetry -->|Yes| Retry[Retry Transaction]
    CheckRetry -->|No| UpdateFailed[Update Status: Failed]
    
    Retry --> AcquireNonce
    UpdateSuccess --> NotifyClient[Return Transaction Hash]
    UpdateFailed --> NotifyError[Return Error]
    
    NotifyClient --> End([Complete])
    NotifyError --> End
    Error --> End
    
    style CreateJob fill:#4dabf7,stroke:#1971c2
    style SubmitTx fill:#ffd93d,stroke:#f59f00
    style UpdateSuccess fill:#51cf66,stroke:#2f9e44
    style UpdateFailed fill:#ff6b6b,stroke:#c92a2a
```

## 9. Monitoring Dashboard Layout

```mermaid
graph TB
    subgraph "Real-time Metrics Dashboard"
        A[TPS Gauge<br/>Current: 200 TPS]
        B[Success Rate<br/>98.5%]
        C[Queue Depth<br/>125 pending]
    end
    
    subgraph "Latency Distribution"
        D[P50: 1.2s]
        E[P95: 4.5s]
        F[P99: 8.2s]
    end
    
    subgraph "Error Tracking"
        G[5xx Errors: 23]
        H[ETIMEDOUT: 0]
        I[Nonce Conflicts: 12]
    end
    
    subgraph "Resource Usage"
        J[CPU: 65%]
        K[Memory: 3.2GB]
        L[Redis Ops: 12k/s]
    end
    
    style A fill:#51cf66,stroke:#2f9e44
    style B fill:#51cf66,stroke:#2f9e44
    style H fill:#51cf66,stroke:#2f9e44
```

## 10. Phase Implementation Timeline

```mermaid
timeline
    title 200 TPS Implementation Roadmap
    
    Week 1-2 : Testnet Setup
             : Create accounts
             : Deploy contracts
             : Bootstrap receivers
             : Baseline benchmark
    
    Week 3-4 : Service Optimization
             : Redis queue
             : Nonce coordinator
             : Dynamic batching
             : Circuit breaker
    
    Week 5-6 : Horizontal Scaling
             : 4 API instances
             : Nginx load balancer
             : Redis cluster
             : Monitoring setup
    
    Week 7-8 : Validation
             : 200 TPS sustained test
             : Performance tuning
             : Documentation
             : CI/CD integration
```

---

## How to Use These Diagrams

### GitHub (Automatic Rendering)
All Mermaid diagrams will render automatically when viewing this file on GitHub.

### Local Development
Install Mermaid CLI:
```bash
npm install -g @mermaid-js/mermaid-cli
```

Generate PNG/SVG:
```bash
mmdc -i docs/ARCHITECTURE_DIAGRAMS.md -o diagrams/architecture.png
```

### VS Code
Install "Markdown Preview Mermaid Support" extension for inline preview.

---

*Diagrams created to visualize the benchmark workflow, architecture, and roadmap to 200 TPS.*
