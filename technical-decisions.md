# Technical Decisions & Architecture Decision Records (ADRs)

## Overview

This document captures key technical decisions made during the architecture and implementation of estaie's platform. Each decision is documented with context, alternatives considered, and rationale.

---

## ADR-001: Cloud Run vs GKE for Container Orchestration

**Date:** 2025-12-01  
**Status:** Accepted  
**Decision Makers:** EM, CTO

### Context

We need to deploy containerized services (NestJS API Gateway, Go microservices) with auto-scaling capabilities to handle variable traffic (1K bookings/sec peak, 100K concurrent sessions).

### Decision

Use **Cloud Run** for initial deployment (30-day timeline), with a migration path to GKE if needed.

### Alternatives Considered

1. **Google Kubernetes Engine (GKE)**
   - **Pros:** Full control, portable, mature ecosystem
   - **Cons:** Complex setup, requires K8s expertise, higher operational overhead
   - **Timeline:** 2-3 weeks just for cluster setup

2. **Cloud Run (Chosen)**
   - **Pros:** Managed auto-scaling, scale-to-zero, fast deployment, lower operational overhead
   - **Cons:** Less control, potential cold starts, vendor lock-in
   - **Timeline:** 2-3 days for setup

3. **App Engine**
   - **Pros:** Fully managed, simple deployment
   - **Cons:** Limited customization, older platform, less flexibility
   - **Timeline:** 1 week

### Rationale

- **Time constraint:** 30-day deadline requires fastest path to production
- **Team size:** Small team (13 engineers) benefits from managed services
- **Uncertain load:** Scale-to-zero saves costs during ramp-up
- **Migration path:** Can containerize and move to GKE later if needed (estimated 2-3 months)

### Consequences

**Positive:**
- Faster time to market (days vs weeks)
- Lower operational overhead (no cluster management)
- Cost-effective for variable load (scale-to-zero)
- Built-in load balancing and traffic splitting

**Negative:**
- Cold starts (1-3s) for scaled-to-zero instances (mitigated with min instances)
- Less control over networking and infrastructure
- Potential vendor lock-in (mitigated with standard containers)

### Success Metrics

- Deploy to production within 7 days
- Auto-scale from 10 → 1000 instances in < 60s
- P95 latency < 500ms (including cold starts)

### Review Date

Review after 3 months of production operation. Consider GKE if:
- Sustained traffic > 10K RPS
- Need for advanced networking (service mesh, custom CNI)
- Cost optimization at scale (reserved instances)

---

## ADR-002: PostgreSQL vs Firestore for Transactional Data

**Date:** 2025-12-01  
**Status:** Accepted  
**Decision Makers:** EM, Backend TL

### Context

We need a database for transactional data (bookings, payments, inventory) with ACID guarantees and complex query support.

### Decision

Use **PostgreSQL 16 (Cloud SQL)** for transactional data, with **Firestore** for real-time features (chat, presence).

### Alternatives Considered

1. **PostgreSQL (Chosen)**
   - **Pros:** ACID guarantees, complex queries, mature ecosystem, cost-effective
   - **Cons:** Vertical scaling limits, manual sharding for extreme scale
   - **Cost:** ~$200/month for 100GB

2. **Firestore**
   - **Pros:** Auto-scaling, real-time updates, offline support
   - **Cons:** Limited queries (no joins), eventual consistency, higher cost
   - **Cost:** ~$500/month for 100GB

3. **CockroachDB**
   - **Pros:** Distributed SQL, horizontal scaling, multi-region
   - **Cons:** Higher complexity, newer technology, higher cost
   - **Cost:** ~$1000/month for equivalent capacity

### Rationale

- **ACID guarantees:** Critical for financial transactions (payments, bookings)
- **Complex queries:** Reporting, analytics, admin dashboards require joins and aggregations
- **Mature ecosystem:** ORMs (Prisma, TypeORM), migration tools, monitoring
- **Cost:** More predictable at scale ($200/month vs $500/month)
- **Team expertise:** Team has more experience with PostgreSQL

### Consequences

**Positive:**
- Strong consistency for financial transactions
- Rich query capabilities for reporting
- Lower cost at current scale
- Familiar tooling and ecosystem

**Negative:**
- Vertical scaling limits (mitigated with read replicas)
- Manual sharding required for extreme scale (> 10TB)
- No built-in real-time updates (use Pub/Sub for events)

### Implementation Details

- **Primary instance:** 16 vCPU, 64GB RAM (UAE region)
- **Read replicas:** 2 per region (UAE, KSA, UK)
- **Connection pooling:** PgBouncer (25 connections per service)
- **Partitioning:** Bookings table partitioned by month
- **Indexes:** B-tree for lookups, GiST for geospatial, GIN for JSONB

### Success Metrics

- P95 query latency < 50ms
- Handle 10K queries/sec
- 99.95% uptime SLA

---

## ADR-003: Pub/Sub vs Cloud Tasks for Event Processing

**Date:** 2025-12-01  
**Status:** Accepted  
**Decision Makers:** EM, Backend TL

### Decision

Use **both** Pub/Sub and Cloud Tasks for different use cases:
- **Pub/Sub:** Event broadcasting, real-time partner sync, fan-out patterns
- **Cloud Tasks:** Scheduled jobs, delayed retries, rate-limited operations

### Rationale

**Pub/Sub Advantages:**
- **Fan-out:** One event → multiple subscribers (booking.confirmed → notifications + partner sync + analytics)
- **Decoupling:** Publishers don't know about subscribers
- **Throughput:** 1M+ messages/sec
- **Ordering:** Optional ordering keys
- **Dead letter queues:** Automatic retry + DLQ

**Cloud Tasks Advantages:**
- **Scheduling:** Execute at specific time (e.g., reminder emails, booking timeouts)
- **Rate limiting:** Built-in token bucket algorithm
- **Deduplication:** Task names prevent duplicates
- **HTTP targets:** Direct HTTP endpoint invocation

### Use Cases

| Use Case | Technology | Reason |
|----------|-----------|--------|
| **Booking confirmed event** | Pub/Sub | Fan-out to multiple subscribers |
| **Partner sync** | Pub/Sub | Real-time, high throughput |
| **Webhook delivery** | Pub/Sub + DLQ | At-least-once delivery |
| **Booking timeout (15 min)** | Cloud Tasks | Delayed execution |
| **Email reminders** | Cloud Tasks | Scheduled execution |
| **Rate-limited API calls** | Cloud Tasks | Built-in rate limiting |

### Consequences

**Positive:**
- Use the right tool for each use case
- Pub/Sub for high-throughput event processing
- Cloud Tasks for scheduled and rate-limited operations

**Negative:**
- Two systems to manage and monitor
- Need to understand when to use each

---

## ADR-004: Saga Pattern for Distributed Transactions

**Date:** 2025-12-01  
**Status:** Accepted  
**Decision Makers:** EM, Backend TL

### Context

A booking involves multiple operations across different services (inventory, booking, payment, partner sync, notifications). We need to ensure atomicity without distributed transactions (2PC).

### Decision

Use **Saga Pattern (Choreography-based)** with **Outbox Pattern** for guaranteed event delivery.

### Alternatives Considered

1. **Two-Phase Commit (2PC)**
   - **Pros:** Strong consistency, atomic commits
   - **Cons:** Blocking, performance issues, complexity, doesn't scale
   - **Decision:** ❌ Not suitable for distributed systems

2. **Saga Pattern - Orchestration**
   - **Pros:** Centralized control, easier to debug
   - **Cons:** Single point of failure, orchestrator complexity
   - **Decision:** ❌ Adds complexity and latency

3. **Saga Pattern - Choreography (Chosen)**
   - **Pros:** Decoupled services, scalable, resilient
   - **Cons:** Harder to debug, eventual consistency
   - **Decision:** ✅ Best fit for our architecture

### Rationale

- **Decoupling:** Services don't directly depend on each other
- **Scalability:** Each service scales independently
- **Resilience:** Failures are handled via compensating transactions
- **Flexibility:** Easy to add new steps (e.g., new notification channel)

### Implementation

**Happy Path:**
```
1. Booking Service: Create booking (PENDING_PAYMENT)
   → Publish: booking.created

2. Inventory Service: Reserve unit (SOFT)
   → Publish: inventory.reserved

3. Payment Service: Create payment intent
   → User completes payment
   → Publish: payment.completed

4. Booking Service: Update booking (CONFIRMED)
   → Publish: booking.confirmed

5. Inventory Service: Convert to hard reservation
   → Publish: inventory.updated

6. Partner Sync Service: Sync with partners
7. Notification Service: Send confirmations
```

**Failure Path (Payment fails):**
```
1. Payment Service: Publish: payment.failed

2. Booking Service: Update booking (CANCELLED)
   → Publish: booking.cancelled

3. Inventory Service: Release reservation
   → Publish: inventory.released
```

### Consequences

**Positive:**
- Services are decoupled and independently scalable
- Failures are handled gracefully with compensating transactions
- Easy to add new steps or services

**Negative:**
- Eventual consistency (data may be temporarily inconsistent)
- Harder to debug distributed flows (mitigated with distributed tracing)
- Need to design compensating transactions carefully

### Success Metrics

- < 0.01% failed transactions (no orphaned bookings or payments)
- 100% event delivery (via outbox pattern)
- < 5s P95 latency for booking flow

---

## ADR-005: Redis Distributed Locks for Double-Booking Prevention

**Date:** 2025-12-01  
**Status:** Accepted  
**Decision Makers:** EM, Backend TL

### Context

We need to prevent double-bookings when multiple users try to book the same property for overlapping dates.

### Decision

Use **Redis distributed locks (Redlock algorithm)** combined with **database constraints** for defense in depth.

### Alternatives Considered

1. **Database row locks**
   - **Pros:** Simple, built-in
   - **Cons:** Locks held during entire transaction, can cause deadlocks
   - **Decision:** ❌ Too slow for high-throughput

2. **Optimistic locking (version column)**
   - **Pros:** No locks, good for low contention
   - **Cons:** Requires retries, not suitable for high contention
   - **Decision:** ✅ Use as secondary defense

3. **Redis distributed locks (Chosen)**
   - **Pros:** Fast, works across multiple servers, configurable TTL
   - **Cons:** Requires Redis cluster, potential lock expiry issues
   - **Decision:** ✅ Best fit for high-throughput

### Implementation

```typescript
// 1. Acquire lock (30s TTL)
const lock = await redis.lock(
  `booking:${propertyId}:${checkIn}:${checkOut}`,
  30000
);

try {
  // 2. Check availability in database
  const available = await checkAvailability(propertyId, checkIn, checkOut);
  if (!available) throw new ConflictException('Property not available');

  // 3. Create booking
  await createBooking({ propertyId, checkIn, checkOut });
} finally {
  // 4. Release lock
  await lock.unlock();
}
```

**Defense in Depth:**
- **Layer 1:** Redis distributed lock (prevents concurrent access)
- **Layer 2:** Database constraint (prevents overlapping bookings)
- **Layer 3:** Optimistic locking (version column for updates)

### Consequences

**Positive:**
- Fast lock acquisition (< 5ms)
- Works across multiple API instances
- Prevents double-bookings even under high load

**Negative:**
- Requires Redis cluster for HA
- Lock expiry can cause issues (mitigated with 30s TTL)
- Need to handle lock acquisition failures

### Success Metrics

- Zero double-bookings in load tests (1K bookings/sec)
- < 5ms P95 lock acquisition time
- < 1% lock acquisition failures

---

## ADR-006: Multi-Region Deployment Strategy

**Date:** 2025-12-01  
**Status:** Accepted  
**Decision Makers:** EM, CTO

### Context

We need to deploy to 3 regions (UAE, KSA, UK) within 30 days, with data residency compliance and failover capabilities.

### Decision

Use **Active-Active (Read) + Active-Passive (Write)** architecture:
- **Writes:** Route to primary database (UAE)
- **Reads:** Route to local read replica
- **Failover:** Automatic promotion of replica to primary

### Alternatives Considered

1. **Single Region (UAE only)**
   - **Pros:** Simplest, no data replication
   - **Cons:** High latency for KSA/UK users, no compliance
   - **Decision:** ❌ Doesn't meet requirements

2. **Multi-Region Active-Active (writes)**
   - **Pros:** Best performance, no single point of failure
   - **Cons:** Complex conflict resolution, eventual consistency
   - **Decision:** ❌ Too complex for 30-day timeline

3. **Multi-Region Active-Passive (Chosen)**
   - **Pros:** Simpler, strong consistency, automatic failover
   - **Cons:** Higher write latency for non-UAE users
   - **Decision:** ✅ Best balance of simplicity and performance

### Implementation

```
Normal Operation:
- UAE users → UAE API → UAE database (primary)
- KSA users → KSA API → KSA database (read replica)
- UK users → UK API → UK database (read replica)

UAE Region Failure:
1. Health check fails (3x in 15s)
2. Promote KSA replica to primary (automatic)
3. Update DNS to route writes to KSA
4. Notify on-call engineer
5. Estimated downtime: 30-60s
```

### Data Residency

| Data Type | UAE | KSA | UK | Replication |
|-----------|-----|-----|----|--------------|
| **User PII** | ✅ Local | ✅ Local | ✅ Local | ❌ No cross-region |
| **Bookings** | ✅ Local | ✅ Local | ✅ Local | ✅ Read replicas only |
| **Payments** | ✅ Local | ✅ Local | ✅ Local | ❌ No cross-region |
| **Property data** | ✅ Shared | ✅ Shared | ✅ Shared | ✅ Full replication |

### Consequences

**Positive:**
- Low latency for reads (local replica)
- Strong consistency for writes (single primary)
- Automatic failover (< 60s)
- Data residency compliance

**Negative:**
- Higher write latency for non-UAE users (50-100ms)
- Single point of failure for writes (mitigated with failover)
- Read replicas lag by 1-5s (acceptable for most use cases)

### Success Metrics

- < 50ms P95 latency for regional users (reads)
- < 60s failover time
- Zero data loss during failover
- 99.9% uptime SLA

---

## ADR-007: Observability Stack

**Date:** 2025-12-01  
**Status:** Accepted  
**Decision Makers:** EM, DevOps Lead

### Decision

Use **Cloud Logging + Cloud Monitoring + Cloud Trace** for observability, with **Sentry** for error tracking and **Grafana** for visualization.

### Rationale

**Logging:**
- **Cloud Logging:** Native GCP integration, structured logging, log-based metrics
- **Sentry:** Error tracking, stack traces, release tracking

**Metrics:**
- **Cloud Monitoring:** Native GCP integration, custom metrics, alerting
- **Prometheus:** Open-source, rich ecosystem, Grafana integration

**Tracing:**
- **Cloud Trace:** Native GCP integration, automatic instrumentation
- **OpenTelemetry:** Vendor-neutral, portable

**Visualization:**
- **Grafana:** Rich dashboards, alerting, plugin ecosystem

### Implementation

```typescript
// Structured logging
logger.log('Creating booking', 'BookingsController', {
  userId: dto.userId,
  propertyId: dto.propertyId,
});

// Custom metrics
metrics.recordBookingCreated(propertyType, region);

// Distributed tracing
const span = tracer.startSpan('process_booking');
span.setAttribute('booking.id', booking.id);
// ... do work ...
span.end();
```

### Consequences

**Positive:**
- Comprehensive observability across all services
- Native GCP integration (no additional setup)
- Rich visualization with Grafana
- Vendor-neutral tracing with OpenTelemetry

**Negative:**
- Multiple tools to manage (Cloud Logging, Sentry, Grafana)
- Need to learn multiple UIs
- Cost of Cloud Monitoring at scale

### Success Metrics

- < 5 min alert delivery time
- 100% of critical alerts have runbooks
- < 30 min MTTR (mean time to resolution)

---

## Summary of Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Container Orchestration** | Cloud Run | Fast deployment, managed auto-scaling |
| **Database** | PostgreSQL | ACID guarantees, complex queries |
| **Event Processing** | Pub/Sub + Cloud Tasks | Right tool for each use case |
| **Distributed Transactions** | Saga Pattern | Decoupled, scalable, resilient |
| **Double-Booking Prevention** | Redis Locks | Fast, distributed, defense in depth |
| **Multi-Region** | Active-Passive | Simple, compliant, automatic failover |
| **Observability** | Cloud Monitoring + Grafana | Comprehensive, native integration |

---

## Review Process

These decisions will be reviewed:
- **Monthly:** Review metrics and adjust if needed
- **Quarterly:** Review with CTO and stakeholders
- **Annually:** Major architecture review

---

## Change Log

| Date | Decision | Status | Reason |
|------|----------|--------|--------|
| 2025-12-01 | ADR-001 to ADR-007 | Accepted | Initial architecture |

---

**Last Updated:** 2025-12-01  
**Next Review:** 2025-03-01

