# 1. System Design & Scalability (40%)

## Table of Contents
1. [High-Level Architecture](#high-level-architecture)
2. [Technology Justification](#technology-justification)
3. [Scaling Patterns](#scaling-patterns)
4. [Resilience Patterns](#resilience-patterns)
5. [Multi-Region Strategy](#multi-region-strategy)

---

## High-Level Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER (Global Users)                      │
│                    Mobile (Flutter) + Web (Next.js 15)                   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    EDGE LAYER (Cloudflare + Vercel)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ Cloudflare   │  │ Vercel Edge  │  │ Cloud CDN    │                  │
│  │ WAF + DDoS   │  │ Functions    │  │ (Static)     │                  │
│  └──────────────┘  └──────────────┘  └──────────────┘                  │
│  • Rate limiting    • Geo-routing     • Asset caching                   │
│  • Bot protection   • A/B testing     • Image optimization              │
│  • SSL termination  • Edge caching    • 100K sessions                   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │  Cloud Load Balancer    │
                    │  (Global Anycast IP)    │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│  UAE Region   │       │  KSA Region   │       │   UK Region   │
│  (Primary)    │       │  (Secondary)  │       │  (Secondary)  │
└───────┬───────┘       └───────┬───────┘       └───────┬───────┘
        │                       │                        │
        └───────────────────────┼────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY LAYER (NestJS)                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Cloud Run (Auto-scaling: 10 → 1000 instances)                   │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐                 │  │
│  │  │ GraphQL    │  │ REST API   │  │ WebSocket  │                 │  │
│  │  │ Gateway    │  │ Gateway    │  │ Gateway    │                 │  │
│  │  └────────────┘  └────────────┘  └────────────┘                 │  │
│  │  • Authentication (JWT + OAuth2.0)                               │  │
│  │  • Authorization (RBAC + ABAC)                                   │  │
│  │  • Rate limiting (Redis Memorystore)                             │  │
│  │  • Request validation (Zod schemas)                              │  │
│  │  • Circuit breakers (Hystrix pattern)                            │  │
│  │  Target: 1K bookings/sec                                         │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   Service Mesh Layer    │
                    │   (Internal gRPC)       │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│   BOOKING     │       │   PAYMENT     │       │   INVENTORY   │
│   SERVICE     │       │   SERVICE     │       │   SERVICE     │
│   (NestJS)    │       │   (Go)        │       │   (Go)        │
└───────┬───────┘       └───────┬───────┘       └───────┬───────┘
        │                       │                        │
        └───────────────────────┼────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     EVENT BUS LAYER (Pub/Sub)                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Topics:                                                          │  │
│  │  • booking.created      • payment.completed                      │  │
│  │  • booking.confirmed    • payment.failed                         │  │
│  │  • booking.cancelled    • inventory.updated                      │  │
│  │  • partner.sync         • notification.send                      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│  PARTNER      │       │  NOTIFICATION │       │   AI/ML       │
│  SYNC         │       │  SERVICE      │       │   SERVICE     │
│  (Go Workers) │       │  (Python)     │       │  (FastAPI)    │
└───────┬───────┘       └───────┬───────┘       └───────┬───────┘
        │                       │                        │
        │  50+ Partners         │  WhatsApp/Twilio      │  Vertex AI
        │  Real-time sync       │  Email/SMS/Push       │  LangChain
        └───────────────────────┼────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │
│  │  PostgreSQL 16   │  │  Redis           │  │  BigQuery        │     │
│  │  (Cloud SQL)     │  │  (Memorystore)   │  │  (Analytics)     │     │
│  ├──────────────────┤  ├──────────────────┤  ├──────────────────┤     │
│  │ • Bookings       │  │ • Sessions       │  │ • Data warehouse │     │
│  │ • Payments       │  │ • Locks          │  │ • ML training    │     │
│  │ • Inventory      │  │ • Cache          │  │ • Reporting      │     │
│  │ • Users          │  │ • Rate limits    │  │ • Analytics      │     │
│  │                  │  │                  │  │                  │     │
│  │ Primary + 2      │  │ HA cluster       │  │ Streaming from   │     │
│  │ read replicas    │  │ Multi-AZ         │  │ Cloud SQL        │     │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘     │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐                            │
│  │  Firestore       │  │  Cloud Storage   │                            │
│  │  (Real-time)     │  │  (Objects)       │                            │
│  ├──────────────────┤  ├──────────────────┤                            │
│  │ • Live updates   │  │ • Documents      │                            │
│  │ • Presence       │  │ • Images         │                            │
│  │ • Chat           │  │ • Backups        │                            │
│  └──────────────────┘  └──────────────────┘                            │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL INTEGRATIONS                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │
│  │  Payment         │  │  Communication   │  │  PMS/Channels    │     │
│  │  Gateways        │  │  Platforms       │  │                  │     │
│  ├──────────────────┤  ├──────────────────┤  ├──────────────────┤     │
│  │ • Stripe         │  │ • WhatsApp       │  │ • Booking.com    │     │
│  │ • Tamara         │  │ • Twilio         │  │ • Expedia        │     │
│  │ • Adyen          │  │ • Telegram       │  │ • Airbnb         │     │
│  │ • Paymob         │  │ • SendGrid       │  │ • Custom PMS     │     │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow: Booking Transaction

```
1. User Request
   ↓
2. Cloudflare WAF (DDoS protection, rate limiting)
   ↓
3. Vercel Edge (Geo-routing, edge caching)
   ↓
4. Cloud Load Balancer (Route to nearest region)
   ↓
5. API Gateway (Auth, validation, circuit breaker)
   ↓
6. Booking Service
   ├─→ Acquire Redis lock (prevent double-booking)
   ├─→ Check inventory (PostgreSQL read replica)
   ├─→ Create booking (PostgreSQL primary, status=PENDING)
   ├─→ Publish booking.created event (Pub/Sub)
   └─→ Return booking ID + payment URL
   ↓
7. Payment Service (subscribes to booking.created)
   ├─→ Create Stripe payment intent (idempotency key)
   ├─→ Store payment record (PostgreSQL)
   └─→ Return payment URL to user
   ↓
8. User completes payment (Stripe webhook)
   ↓
9. Payment Service
   ├─→ Verify webhook signature
   ├─→ Update payment status (PostgreSQL)
   ├─→ Publish payment.completed event (Pub/Sub)
   └─→ Release Redis lock
   ↓
10. Booking Service (subscribes to payment.completed)
    ├─→ Update booking status (PENDING → CONFIRMED)
    ├─→ Decrement inventory (PostgreSQL)
    ├─→ Publish booking.confirmed event (Pub/Sub)
    └─→ Store in outbox table (for guaranteed delivery)
    ↓
11. Partner Sync Service (subscribes to booking.confirmed)
    ├─→ Transform booking data (per partner format)
    ├─→ Send to partner API (with retry + exponential backoff)
    ├─→ Update sync status (PostgreSQL)
    └─→ Mark outbox message as processed
    ↓
12. Notification Service (subscribes to booking.confirmed)
    ├─→ Send confirmation email (SendGrid)
    ├─→ Send WhatsApp message (Twilio)
    └─→ Send push notification (Firebase)
```

---

## Technology Justification

### 1. Cloud Run vs GKE

**Decision: Cloud Run for initial launch, with GKE migration path**

| Criteria | Cloud Run ✅ | GKE |
|----------|-------------|-----|
| **Time to market** | Days | Weeks |
| **Operational complexity** | Low (managed) | High (self-managed) |
| **Auto-scaling** | Built-in (0 → 1000 instances) | Requires HPA + cluster autoscaler |
| **Cost (low traffic)** | $0 (scale-to-zero) | $200+/month (min cluster) |
| **Cost (high traffic)** | ~$500/month | ~$300/month |
| **Cold start** | 1-3s (acceptable for API) | None |
| **Networking** | Simplified | Full control |
| **Vendor lock-in** | Medium | Low (portable) |

**Rationale:**
- **30-day deadline:** Cloud Run provides fastest path to production
- **Uncertain load:** Scale-to-zero saves costs during ramp-up
- **Team size:** Smaller team benefits from managed infrastructure
- **Migration path:** Can containerize and move to GKE later if needed

**When to migrate to GKE:**
- Sustained traffic > 10K RPS
- Need for advanced networking (service mesh, custom CNI)
- Cost optimization at scale (reserved instances)
- Multi-tenancy isolation requirements

---

### 2. Pub/Sub vs Cloud Tasks

**Decision: Both, for different use cases**

| Use Case | Technology | Reason |
|----------|-----------|--------|
| **Event broadcasting** | Pub/Sub | Fan-out to multiple subscribers |
| **Partner sync** | Pub/Sub | Real-time, high throughput |
| **Webhook delivery** | Pub/Sub + Dead Letter Queue | At-least-once delivery |
| **Scheduled jobs** | Cloud Tasks | Delayed execution (e.g., payment timeout) |
| **Rate-limited operations** | Cloud Tasks | Built-in rate limiting |
| **Retry with backoff** | Both | Pub/Sub for events, Tasks for jobs |

**Pub/Sub Advantages:**
- **Fan-out:** One event → multiple subscribers (booking.confirmed → notifications + partner sync + analytics)
- **Decoupling:** Publishers don't know about subscribers
- **Throughput:** 1M+ messages/sec
- **Ordering:** Optional ordering keys
- **Dead letter queues:** Automatic retry + DLQ

**Cloud Tasks Advantages:**
- **Scheduling:** Execute at specific time (e.g., reminder emails)
- **Rate limiting:** Built-in token bucket algorithm
- **Deduplication:** Task names prevent duplicates
- **HTTP targets:** Direct HTTP endpoint invocation

**Example Architecture:**
```typescript
// Pub/Sub for event broadcasting
await pubsub.topic('booking.confirmed').publish({
  bookingId: '123',
  userId: 'user-456',
  propertyId: 'prop-789',
  timestamp: Date.now()
});

// Cloud Tasks for delayed jobs
await cloudTasks.createTask({
  scheduleTime: Date.now() + 30 * 60 * 1000, // 30 min
  httpRequest: {
    url: 'https://api.estaie.com/bookings/123/timeout',
    httpMethod: 'POST'
  }
});
```

---

### 3. PostgreSQL vs Firestore for Bookings

**Decision: PostgreSQL (Cloud SQL) for transactional data**

| Criteria | PostgreSQL ✅ | Firestore |
|----------|--------------|-----------|
| **ACID guarantees** | Full (serializable isolation) | Limited (single document) |
| **Complex queries** | Joins, aggregations, window functions | Limited (no joins) |
| **Transactions** | Multi-table, multi-row | Single document or batch |
| **Schema evolution** | Migrations (controlled) | Schemaless (flexible) |
| **Cost (100GB)** | ~$200/month | ~$500/month |
| **Latency (read)** | 5-10ms | 10-50ms |
| **Latency (write)** | 10-20ms | 50-100ms |
| **Scaling** | Vertical + read replicas | Automatic horizontal |

**Rationale:**
- **Financial transactions:** ACID guarantees critical for payments
- **Complex queries:** Reporting, analytics, admin dashboards
- **Mature ecosystem:** ORMs (Prisma, TypeORM), migration tools, monitoring
- **Cost:** More predictable at scale

**When to use Firestore:**
- Real-time updates (chat, presence, live inventory)
- Mobile-first applications (offline support)
- Schemaless data (user preferences, settings)
- Geographic distribution (multi-region writes)

---

### 4. Redis (Memorystore) Use Cases

**Decision: Redis for distributed locks, caching, and rate limiting**

**Use Cases:**

1. **Distributed Locks (Redlock algorithm)**
```typescript
// Prevent double-booking
const lock = await redis.lock(`booking:property:${propertyId}:${dates}`, 5000);
try {
  // Check availability
  // Create booking
  // Decrement inventory
} finally {
  await lock.unlock();
}
```

2. **Caching (Read-through pattern)**
```typescript
// Cache property details (TTL: 5 min)
const property = await redis.get(`property:${id}`);
if (!property) {
  property = await db.properties.findById(id);
  await redis.set(`property:${id}`, property, 'EX', 300);
}
```

3. **Rate Limiting (Token bucket)**
```typescript
// 100 requests per minute per user
const key = `rate:${userId}`;
const count = await redis.incr(key);
if (count === 1) await redis.expire(key, 60);
if (count > 100) throw new RateLimitError();
```

4. **Session Management**
```typescript
// Store session data (TTL: 24 hours)
await redis.set(`session:${sessionId}`, JSON.stringify(user), 'EX', 86400);
```

**Configuration:**
- **HA setup:** Redis cluster with automatic failover
- **Persistence:** RDB snapshots + AOF for durability
- **Memory:** 16GB (M3 tier) with eviction policy `allkeys-lru`
- **Connection pooling:** 50 connections per API instance

---

## Scaling Patterns

### 1. Horizontal Scaling (Cloud Run)

**Auto-scaling Configuration:**
```yaml
# cloud-run-config.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: api-gateway
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "10"      # Always warm
        autoscaling.knative.dev/maxScale: "1000"    # Peak capacity
        autoscaling.knative.dev/target: "80"        # 80 concurrent requests/instance
        autoscaling.knative.dev/metric: "concurrency"
    spec:
      containerConcurrency: 100                      # Max concurrent requests
      timeoutSeconds: 300                            # 5 min timeout
      containers:
      - image: gcr.io/estaie/api-gateway:latest
        resources:
          limits:
            cpu: "2"
            memory: "2Gi"
```

**Scaling Triggers:**
- **CPU > 70%:** Scale up
- **Memory > 80%:** Scale up
- **Concurrent requests > 80/instance:** Scale up
- **Request queue > 100:** Scale up (aggressive)

**Cold Start Mitigation:**
- **Min instances:** 10 (always warm in each region)
- **Startup probe:** Health check before routing traffic
- **Lazy initialization:** Defer heavy operations (DB connections, cache warm-up)

---

### 2. Database Scaling (PostgreSQL)

**Read Replicas:**
```
Primary (UAE)
├─→ Read Replica 1 (UAE) - API reads
├─→ Read Replica 2 (UAE) - Analytics
├─→ Read Replica 3 (KSA) - Cross-region reads
└─→ Read Replica 4 (UK) - Cross-region reads
```

**Connection Pooling (PgBouncer):**
```ini
# pgbouncer.ini
[databases]
estaie = host=primary.db port=5432 dbname=estaie

[pgbouncer]
pool_mode = transaction              # Release connection after transaction
max_client_conn = 10000              # Max client connections
default_pool_size = 25               # Connections per user/db
reserve_pool_size = 5                # Emergency connections
reserve_pool_timeout = 3             # Wait 3s for connection
```

**Query Optimization:**
- **Indexes:** B-tree for lookups, GiST for geospatial, GIN for JSONB
- **Partitioning:** Bookings table partitioned by month (range partitioning)
- **Materialized views:** Pre-computed aggregations for dashboards
- **Query caching:** Redis for frequently accessed data

**Scaling Strategy:**
```
Phase 1 (0-1K RPS):  Single primary + 1 read replica
Phase 2 (1K-5K RPS): Single primary + 2 read replicas + PgBouncer
Phase 3 (5K-10K RPS): Vertical scale primary (32 vCPU, 128GB RAM)
Phase 4 (10K+ RPS):  Sharding by region (UAE, KSA, UK databases)
```

---

### 3. Caching Strategy (Multi-Layer)

```
┌─────────────────────────────────────────────────┐
│ L1: Edge Cache (Cloudflare + Vercel)           │
│ • Static assets (images, CSS, JS)              │
│ • API responses (public data)                  │
│ • TTL: 1 hour - 1 day                          │
│ • Hit rate: 90%+                               │
└────────────────┬────────────────────────────────┘
                 │ Cache miss
                 ▼
┌─────────────────────────────────────────────────┐
│ L2: Redis (Memorystore)                        │
│ • Property details                             │
│ • User sessions                                │
│ • Search results                               │
│ • TTL: 5 min - 1 hour                          │
│ • Hit rate: 80%+                               │
└────────────────┬────────────────────────────────┘
                 │ Cache miss
                 ▼
┌─────────────────────────────────────────────────┐
│ L3: Database (PostgreSQL)                      │
│ • Source of truth                              │
│ • Read replicas for scaling                   │
└─────────────────────────────────────────────────┘
```

**Cache Invalidation:**
```typescript
// Write-through pattern (update cache on write)
async function updateProperty(id: string, data: PropertyUpdate) {
  // 1. Update database
  await db.properties.update(id, data);
  
  // 2. Invalidate cache
  await redis.del(`property:${id}`);
  
  // 3. Purge edge cache
  await cloudflare.purgeCache(`/api/properties/${id}`);
}

// Cache-aside pattern (lazy loading)
async function getProperty(id: string) {
  // 1. Try cache
  let property = await redis.get(`property:${id}`);
  
  // 2. Cache miss → load from DB
  if (!property) {
    property = await db.properties.findById(id);
    await redis.set(`property:${id}`, property, 'EX', 300);
  }
  
  return property;
}
```

---

### 4. Load Balancing Strategy

**Global Load Balancer (Cloud Load Balancing):**
```
User Request
↓
Geo-routing (based on client IP)
├─→ UAE users → UAE region (primary)
├─→ KSA users → KSA region (secondary)
├─→ UK users → UK region (secondary)
└─→ Other → Nearest region (latency-based)

Failover:
- Health checks every 5s
- Unhealthy threshold: 2 consecutive failures
- Failover time: < 10s
- Automatic recovery when healthy
```

**Regional Load Balancer:**
```
Cloud Run Service (per region)
├─→ Instance 1 (warm)
├─→ Instance 2 (warm)
├─→ ...
└─→ Instance N (auto-scaled)

Algorithm: Least outstanding requests
Sticky sessions: Cookie-based (for WebSocket)
```

---

## Resilience Patterns

### 1. Circuit Breaker Pattern

**Implementation (using opossum library):**
```typescript
import CircuitBreaker from 'opossum';

// Wrap external API calls
const paymentCircuit = new CircuitBreaker(stripeAPI.createPayment, {
  timeout: 5000,              // 5s timeout
  errorThresholdPercentage: 50, // Open circuit if 50% fail
  resetTimeout: 30000,        // Try again after 30s
  rollingCountTimeout: 10000, // 10s rolling window
});

// Fallback behavior
paymentCircuit.fallback(() => {
  // Queue payment for retry
  return { status: 'QUEUED', message: 'Payment processing delayed' };
});

// Monitoring
paymentCircuit.on('open', () => {
  logger.error('Payment circuit opened - too many failures');
  alerting.sendAlert('payment-circuit-open');
});

paymentCircuit.on('halfOpen', () => {
  logger.info('Payment circuit half-open - testing recovery');
});
```

**Circuit States:**
```
CLOSED (normal)
├─→ Success rate > 50% → Stay CLOSED
└─→ Failure rate > 50% → OPEN

OPEN (failing)
├─→ Wait 30s → HALF_OPEN
└─→ Reject all requests (use fallback)

HALF_OPEN (testing)
├─→ Next request succeeds → CLOSED
└─→ Next request fails → OPEN
```

---

### 2. Retry Logic with Exponential Backoff

**Implementation:**
```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
    factor: number;
  }
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on client errors (4xx)
      if (error.statusCode >= 400 && error.statusCode < 500) {
        throw error;
      }
      
      // Calculate delay: min(initialDelay * factor^attempt, maxDelay)
      const delay = Math.min(
        options.initialDelay * Math.pow(options.factor, attempt),
        options.maxDelay
      );
      
      // Add jitter to prevent thundering herd
      const jitter = delay * 0.1 * Math.random();
      
      await sleep(delay + jitter);
    }
  }
  
  throw lastError;
}

// Usage
const booking = await retryWithBackoff(
  () => partnerAPI.createBooking(data),
  {
    maxRetries: 3,
    initialDelay: 1000,  // 1s
    maxDelay: 10000,     // 10s
    factor: 2            // 1s, 2s, 4s, 8s
  }
);
```

---

### 3. Graceful Degradation

**Feature Flags (using Statsig):**
```typescript
// Check if feature is enabled
const enablePartnerSync = await statsig.checkGate('enable-partner-sync');

if (enablePartnerSync) {
  // Full functionality
  await partnerSyncService.syncBooking(booking);
} else {
  // Degraded mode: queue for later
  await queue.enqueue('partner-sync', booking);
}

// Dynamic config
const maxConcurrentBookings = await statsig.getConfig('booking-limits').get('max_concurrent', 1000);
```

**Graceful Degradation Scenarios:**

| Scenario | Degraded Behavior | User Impact |
|----------|------------------|-------------|
| **Partner API down** | Queue sync for retry | Booking succeeds, sync delayed |
| **Payment gateway slow** | Show "processing" UI | Extended wait time |
| **Redis down** | Skip caching, direct DB | Slower responses |
| **Database replica down** | Route to primary | Increased primary load |
| **AI service down** | Skip recommendations | No personalization |

---

### 4. Bulkhead Pattern (Isolation)

**Resource Isolation:**
```typescript
// Separate connection pools for different operations
const bookingPool = new Pool({
  max: 20,              // 20 connections for bookings
  min: 5,
  idleTimeoutMillis: 30000,
});

const analyticsPool = new Pool({
  max: 5,               // 5 connections for analytics
  min: 1,
  idleTimeoutMillis: 60000,
});

// Prevent analytics queries from blocking bookings
async function getBookingStats() {
  return analyticsPool.query('SELECT COUNT(*) FROM bookings');
}
```

**Thread Pool Isolation:**
```typescript
// Separate Cloud Run services for different workloads
const services = {
  'api-gateway': {
    minInstances: 10,
    maxInstances: 1000,
    cpu: 2,
    memory: '2Gi'
  },
  'partner-sync': {
    minInstances: 2,
    maxInstances: 100,
    cpu: 1,
    memory: '1Gi'
  },
  'analytics': {
    minInstances: 1,
    maxInstances: 10,
    cpu: 4,
    memory: '8Gi'
  }
};
```

---

### 5. Timeout Strategy

**Cascading Timeouts:**
```
User Request (30s timeout)
└─→ API Gateway (25s timeout)
    └─→ Booking Service (20s timeout)
        ├─→ Database Query (5s timeout)
        ├─→ Redis Lock (2s timeout)
        └─→ Payment API (15s timeout)
            └─→ Stripe API (10s timeout)
```

**Implementation:**
```typescript
// Request-level timeout
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    res.status(408).json({ error: 'Request timeout' });
  });
  next();
});

// Database query timeout
await db.query('SELECT * FROM bookings WHERE id = $1', [id], {
  timeout: 5000
});

// HTTP client timeout
const response = await axios.post('https://partner.api/booking', data, {
  timeout: 10000,
  signal: AbortSignal.timeout(10000) // Abort after 10s
});
```

---

## Multi-Region Strategy

### 1. Deployment Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                     Global Layer (Shared)                        │
│  • Cloud Load Balancer (Anycast IP)                             │
│  • Cloudflare (WAF, DDoS, Edge Cache)                           │
│  • Cloud DNS (Geo-routing)                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│  UAE Region   │     │  KSA Region   │     │   UK Region   │
│  (Primary)    │     │  (Secondary)  │     │  (Secondary)  │
├───────────────┤     ├───────────────┤     ├───────────────┤
│ • Cloud Run   │     │ • Cloud Run   │     │ • Cloud Run   │
│ • PostgreSQL  │     │ • PostgreSQL  │     │ • PostgreSQL  │
│   (Primary)   │     │   (Replica)   │     │   (Replica)   │
│ • Redis       │     │ • Redis       │     │ • Redis       │
│ • Pub/Sub     │     │ • Pub/Sub     │     │ • Pub/Sub     │
└───────┬───────┘     └───────┬───────┘     └───────┬───────┘
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                    Cross-region replication
```

### 2. Data Residency & Compliance

**Regional Data Isolation:**

| Data Type | UAE | KSA | UK | Replication |
|-----------|-----|-----|----|--------------|
| **User PII** | ✅ Local | ✅ Local | ✅ Local | ❌ No cross-region |
| **Bookings** | ✅ Local | ✅ Local | ✅ Local | ✅ Read replicas only |
| **Payments** | ✅ Local | ✅ Local | ✅ Local | ❌ No cross-region |
| **Property data** | ✅ Shared | ✅ Shared | ✅ Shared | ✅ Full replication |
| **Analytics** | ✅ BigQuery (UAE) | ✅ BigQuery (UAE) | ✅ BigQuery (UK) | ✅ Streaming |

**Compliance Requirements:**
- **GDPR (UK):** Data residency, right to deletion, data portability
- **PDPL (UAE):** Local data storage, consent management
- **PDPL (KSA):** Local data storage, cross-border transfer restrictions

**Implementation:**
```typescript
// Route user data to correct region
function getRegionForUser(userId: string): Region {
  const user = await db.users.findById(userId);
  return user.region; // 'UAE' | 'KSA' | 'UK'
}

// Enforce data residency
async function createBooking(data: BookingData) {
  const region = getRegionForUser(data.userId);
  const db = getDatabaseForRegion(region);
  
  return db.bookings.create(data);
}
```

---

### 3. Failover Strategy

**Active-Active (Read) + Active-Passive (Write):**

```
Normal Operation:
- Writes → UAE (primary database)
- Reads → Local region (read replicas)

UAE Region Failure:
1. Detect failure (health check fails 3x in 15s)
2. Promote KSA replica to primary (automatic)
3. Update DNS to route writes to KSA
4. Notify on-call engineer (PagerDuty)
5. Estimated downtime: 30-60s

Recovery:
1. UAE region comes back online
2. Sync data from KSA (catch-up replication)
3. Failback to UAE (manual, during low-traffic window)
```

**Failover Testing:**
- **Monthly:** Simulate region failure in staging
- **Quarterly:** Chaos engineering in production (controlled)
- **Annually:** Full disaster recovery drill

---

### 4. Cross-Region Latency Optimization

**Latency Budget:**
```
Target: < 500ms end-to-end (P95)

Breakdown:
- Client → Edge: 20ms (CDN)
- Edge → API Gateway: 50ms (cross-region)
- API Gateway → Service: 10ms (internal)
- Service → Database: 30ms (read replica)
- Service → External API: 200ms (payment)
- Response processing: 50ms
- Buffer: 140ms
────────────────────────────────────
Total: 500ms
```

**Optimization Techniques:**
1. **Edge caching:** Serve static content from nearest POP
2. **Read replicas:** Route reads to local region
3. **Async operations:** Use Pub/Sub for non-critical operations
4. **Parallel requests:** Fetch multiple resources concurrently
5. **Connection pooling:** Reuse TCP connections
6. **HTTP/2:** Multiplexing, header compression
7. **gRPC:** Binary protocol for internal services

---

## Performance Targets

### Latency (P95)
- **Edge response:** < 100ms
- **API response (cached):** < 200ms
- **API response (uncached):** < 500ms
- **Database query:** < 50ms
- **External API call:** < 2s

### Throughput
- **API Gateway:** 1K bookings/sec
- **Database:** 10K queries/sec
- **Pub/Sub:** 100K messages/sec
- **Redis:** 100K ops/sec

### Availability
- **Overall SLA:** 99.9% (43 min downtime/month)
- **API Gateway:** 99.95%
- **Database:** 99.95%
- **Edge:** 99.99%

### Scalability
- **Concurrent sessions:** 100K
- **Auto-scale time:** < 60s (10 → 1000 instances)
- **Cold start:** < 3s (P95)

---

## Cost Estimation

### Monthly Cost (at scale)

| Service | Configuration | Cost |
|---------|--------------|------|
| **Cloud Run** | 100 instances avg, 2 vCPU, 2GB | $500 |
| **Cloud SQL** | Primary + 4 replicas, 16 vCPU, 64GB | $1,200 |
| **Redis** | M3 (16GB), HA | $300 |
| **Pub/Sub** | 1B messages/month | $400 |
| **Cloud Storage** | 1TB, 10TB egress | $150 |
| **BigQuery** | 10TB storage, 100TB queries | $800 |
| **Load Balancer** | 100TB egress | $1,000 |
| **Cloudflare** | Pro plan + bandwidth | $200 |
| **Vercel** | Pro plan | $200 |
| **Monitoring** | Cloud Monitoring + Sentry | $300 |
| **Total** | | **$5,050/month** |

**Cost Optimization:**
- **Committed use discounts:** 30% savings on Cloud Run, Cloud SQL
- **Sustained use discounts:** Automatic for long-running instances
- **Preemptible instances:** For batch jobs (80% savings)
- **Caching:** Reduce database load and egress costs
- **Compression:** Reduce bandwidth costs

---

## Next Steps

1. **Review architecture** with CTO and stakeholders
2. **Validate assumptions** (traffic estimates, latency requirements)
3. **Prototype critical paths** (booking flow, payment integration)
4. **Load testing** (simulate 1K bookings/sec)
5. **Security review** (penetration testing, compliance audit)
6. **Cost modeling** (actual vs estimated)
7. **Team training** (tech stack, deployment process)
8. **Phased rollout** (5% → 25% → 100%)

---

**Next:** [Transaction Integrity →](./02-transaction-integrity.md)

