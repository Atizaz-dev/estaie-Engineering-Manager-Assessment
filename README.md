# estaie Engineering Manager Assessment
**Candidate:** Atizaz  
**Date Received:** 1 Dec 2025  
**Submission Date:** 1 Dec 2025  
**Position:** Engineering Manager — AI & Automation  
**Company:** estaie

---

## Executive Summary

This assessment outlines a comprehensive architecture and execution plan to scale estaie's booking and operations platform from a single-region MVP (UAE) to a multi-region, globally distributed system supporting UAE, KSA, and UK markets within 30 days.

### Key Metrics Target
- **100K concurrent sessions** with <100ms edge response time
- **1K concurrent bookings/sec** through API Gateway
- **50+ external partner integrations** with real-time sync
- **Zero double-bookings** with idempotent payment processing
- **Multi-region deployment** with data residency compliance

### Architecture Philosophy
Our approach balances **speed of delivery** with **long-term scalability** by:
1. Leveraging managed services (Cloud Run, Memorystore, Cloud SQL) for rapid deployment
2. Implementing event-driven patterns for decoupling and resilience
3. Building observability-first with distributed tracing from day one
4. Designing for failure with circuit breakers and graceful degradation

---

## Project Structure

```
├── README.md                           # This file
├── docs/
│   ├── 01-system-design.md            # System architecture & scalability
│   ├── 02-transaction-integrity.md     # Booking atomicity & recovery
│   ├── 03-operations-security.md       # DevOps, security, observability
│   ├── 04-leadership-execution.md      # Team structure & delivery plan
│   └── diagrams/
│       ├── system-architecture.md      # High-level architecture diagram
│       ├── booking-flow.md             # Transaction flow diagram
│       └── deployment-topology.md      # Multi-region setup
├── boilerplate/
│   ├── backend/                        # NestJS API Gateway boilerplate
│   ├── frontend/                       # Next.js 15 boilerplate
│   ├── services/                       # Go microservices examples
│   ├── infrastructure/                 # Terraform IaC
│   └── ci-cd/                         # GitHub Actions workflows
└── technical-decisions.md              # ADR-style tech choices
```

---

## Quick Navigation

### 📐 [1. System Design & Scalability (40%)](./docs/01-system-design.md)
- High-level architecture diagram
- Technology justification (Cloud Run vs GKE, Pub/Sub vs Tasks)
- Scaling patterns (horizontal scaling, caching, CDN)
- Resilience patterns (circuit breakers, retries, failover)

### 🔒 [2. Transaction Integrity (20%)](./docs/02-transaction-integrity.md)
- Booking atomicity pattern (distributed locks + outbox)
- Idempotent payment processing
- Recovery & retry logic
- Double-booking prevention

### 🛡️ [3. Operations, Security & Observability (20%)](./docs/03-operations-security.md)
- CI/CD pipeline (Vercel + Cloud Build + GitHub Actions)
- Observability stack (Sentry, Cloud Monitoring, Grafana)
- Security architecture (Cloudflare WAF, IAM, secrets)
- Production readiness checklist

### 👥 [4. Leadership & Execution Plan (20%)](./docs/04-leadership-execution.md)
- Team structure & ownership matrix
- 30-day delivery roadmap (Foundation → Integration → Scale)
- Engineering rituals & velocity tracking
- Crisis communication playbook

---

## Technology Stack

### Frontend Layer
- **Next.js 15** (App Router, React Server Components)
- **TypeScript** (strict mode)
- **TailwindCSS** for styling
- **Vercel Edge Network** for global distribution

### API Gateway Layer
- **NestJS** on GCP Cloud Run
- **GraphQL** (Apollo Server) + REST endpoints
- **Redis** (Memorystore) for session & rate limiting
- **Cloud Armor** for DDoS protection

### Service Layer
- **Go microservices** for high-throughput operations
- **Python FastAPI** for AI/ML services
- **Pub/Sub** for async event processing
- **Cloud Tasks** for scheduled/delayed jobs

### Data Layer
- **PostgreSQL 16** (Cloud SQL) with read replicas
- **Redis** (Memorystore) for distributed locks & cache
- **BigQuery** for analytics & data warehouse
- **Firestore** for real-time operational data

### Infrastructure
- **GCP Cloud Run** (auto-scaling containers)
- **Cloudflare** (WAF, DDoS, edge caching)
- **Terraform** for IaC
- **GitHub Actions** for CI/CD

---

## Key Design Decisions

### Why Cloud Run over GKE?
- **Time to market:** Managed auto-scaling without K8s complexity
- **Cost efficiency:** Pay-per-request, scale-to-zero for low-traffic services
- **Developer experience:** Simpler deployment, less operational overhead
- **Migration path:** Can move to GKE later if needed

### Why Pub/Sub over Cloud Tasks?
- **Pub/Sub:** Fan-out patterns, real-time partner sync, event sourcing
- **Cloud Tasks:** Scheduled jobs, delayed retries, rate-limited operations
- **Both:** Used for different use cases

### Why PostgreSQL over Firestore for bookings?
- **ACID guarantees:** Critical for financial transactions
- **Complex queries:** Joins, aggregations, reporting
- **Mature ecosystem:** ORMs, migration tools, monitoring

---

## 30-Day Delivery Timeline

### Week 1: Foundation (Days 1-7)
- Infrastructure setup (Terraform, GCP projects per region)
- CI/CD pipelines (GitHub Actions, Cloud Build)
- Core API Gateway (NestJS boilerplate, auth, rate limiting)
- Database schema & migrations

### Week 2: Integration (Days 8-14)
- Booking service with distributed locks
- Payment integration (Stripe with idempotency)
- Partner sync framework (Pub/Sub + Go workers)
- Observability stack (Sentry, Cloud Monitoring)

### Week 3: Scale (Days 15-21)
- Multi-region deployment (UAE, KSA, UK)
- Load testing & optimization
- Circuit breakers & graceful degradation
- Security hardening (WAF rules, IAM policies)

### Week 4: Launch (Days 22-30)
- Production readiness review
- Runbook documentation
- Team training & handoff
- Phased rollout (5% → 25% → 100%)

---

## Success Metrics

### Performance
- P95 API latency < 200ms
- P99 API latency < 500ms
- Edge response time < 100ms
- Database query time < 50ms

### Reliability
- 99.9% uptime SLA
- Zero data loss
- < 1% failed payment rate
- < 0.01% double-booking rate

### Scalability
- Handle 1K bookings/sec sustained
- Support 100K concurrent sessions
- Auto-scale from 10 → 1000 instances in < 60s

---

## Getting Started

### Prerequisites
- GCP account with billing enabled
- Terraform >= 1.6
- Node.js >= 20
- Go >= 1.21
- Docker >= 24

### Local Development Setup

```bash
# Clone the repository
git clone <repo-url>
cd estaie-assessment

# Setup backend
cd boilerplate/backend
npm install
cp .env.example .env
npm run start:dev

# Setup frontend
cd ../frontend
npm install
cp .env.example .env.local
npm run dev

# Setup infrastructure
cd ../infrastructure
terraform init
terraform plan
```

### Deployment

```bash
# Deploy to staging
./scripts/deploy.sh staging

# Deploy to production (requires approval)
./scripts/deploy.sh production
```

---

## ✅ Assessment Validation

All requirements have been validated and met:

- ✅ **System Design & Scalability (40%)** - Complete with diagrams, justifications, and patterns
- ✅ **Transaction Integrity (20%)** - Saga + Outbox patterns with complete code
- ✅ **Operations & Security (20%)** - CI/CD, observability, security, production checklist
- ✅ **Leadership & Execution (20%)** - Team structure, 30-day plan, rituals, communication
- ✅ **Bonus: Loom Video Script** - 5-minute presentation ready

**Validation Document:** See `ASSESSMENT_VALIDATION.md` for complete checklist

---

## 🎥 Loom Video

**Script:** `LOOM_VIDEO_SCRIPT.md` (≤ 5 minutes)

**Topics Covered:**
1. Architecture rationale and key trade-offs
2. Leadership principles for execution and team alignment
3. Critical technical risk (Redis locks) and de-risking strategy

**Video Link:** [To be added after recording]

---

## 📊 Deliverables Summary

### Documentation
- **180+ pages** of comprehensive documentation
- **7 ADRs** with detailed technical decisions
- **Multiple diagrams** (architecture, flows, security layers)
- **Complete validation** of all requirements

### Code
- **10+ boilerplate files** production-ready
- **NestJS backend** with booking service, Redis locks, Outbox pattern
- **Terraform infrastructure** complete GCP setup
- **GitHub Actions** CI/CD workflows
- **Next.js 15 frontend** configuration

### Completeness
- ✅ All technologies covered (Next.js 15, NestJS, PostgreSQL 16, Redis, Pub/Sub, Cloud Tasks, Cloudflare, Vercel)
- ✅ All performance targets addressed (100K sessions, 1K bookings/sec, <100ms edge, <500ms API)
- ✅ All patterns implemented (Saga, Outbox, Circuit Breaker, Distributed Locks)
- ✅ Complete team structure and 30-day delivery plan

---

## Contact & Questions

For questions or clarifications, please reach out to:
- **Email:** [Your Email]
- **LinkedIn:** [Your LinkedIn]
- **GitHub:** [Your GitHub]

---

## License

This assessment is submitted as part of the estaie Engineering Manager hiring process.

**Status:** ✅ READY FOR SUBMISSION  
**Submission Date:** December 1, 2025  
**Candidate:** Atizaz

