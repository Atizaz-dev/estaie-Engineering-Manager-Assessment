# 3. Operations, Security & Observability (20%)

## Table of Contents
1. [CI/CD Pipeline](#cicd-pipeline)
2. [Observability Stack](#observability-stack)
3. [Security Architecture](#security-architecture)
4. [Production Readiness Checklist](#production-readiness-checklist)

---

## CI/CD Pipeline

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Developer Workflow                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Repository                                               │
│  • Feature branch                                                │
│  • Pull request                                                  │
│  • Code review                                                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Actions (CI)                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Lint & Type  │  │ Unit Tests   │  │ Integration  │          │
│  │ Check        │  │              │  │ Tests        │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Security     │  │ Build Docker │  │ Push to GCR  │          │
│  │ Scan         │  │ Image        │  │              │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Merge to main                                                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ├──────────────────┬──────────────────┐
                     ▼                  ▼                  ▼
          ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
          │  Vercel          │ │  Cloud Build     │ │  Terraform       │
          │  (Frontend)      │ │  (Backend)       │ │  (Infrastructure)│
          └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
                   │                    │                    │
                   ▼                    ▼                    ▼
          ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
          │  Preview         │ │  Staging         │ │  Staging         │
          │  Deployment      │ │  Environment     │ │  Infrastructure  │
          └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
                   │                    │                    │
                   │                    ▼                    │
                   │          ┌──────────────────┐           │
                   │          │  E2E Tests       │           │
                   │          │  (Playwright)    │           │
                   │          └────────┬─────────┘           │
                   │                   │                     │
                   │                   ▼                     │
                   │          ┌──────────────────┐           │
                   │          │  Load Tests      │           │
                   │          │  (k6)            │           │
                   │          └────────┬─────────┘           │
                   │                   │                     │
                   └───────────────────┴─────────────────────┘
                                       │
                                       ▼
                          ┌──────────────────────┐
                          │  Manual Approval     │
                          │  (for production)    │
                          └──────────┬───────────┘
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │  Production Deploy   │
                          │  • Canary (5%)       │
                          │  • Progressive (25%) │
                          │  • Full (100%)       │
                          └──────────────────────┘
```

---

### GitHub Actions Workflows

#### 1. CI Workflow (Pull Request)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main, develop]

env:
  NODE_VERSION: '20'
  GO_VERSION: '1.21'
  PYTHON_VERSION: '3.11'

jobs:
  # Frontend CI
  frontend-ci:
    name: Frontend CI
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ./frontend
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint
        run: npm run lint
      
      - name: Type check
        run: npm run type-check
      
      - name: Unit tests
        run: npm run test:unit -- --coverage
      
      - name: Build
        run: npm run build
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./frontend/coverage/lcov.info
          flags: frontend

  # Backend CI
  backend-ci:
    name: Backend CI
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ./backend
    
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: estaie_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint
        run: npm run lint
      
      - name: Type check
        run: npm run type-check
      
      - name: Run migrations
        run: npm run migration:run
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/estaie_test
      
      - name: Unit tests
        run: npm run test:unit -- --coverage
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/estaie_test
          REDIS_URL: redis://localhost:6379
      
      - name: Integration tests
        run: npm run test:integration
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/estaie_test
          REDIS_URL: redis://localhost:6379
      
      - name: Build
        run: npm run build
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./backend/coverage/lcov.info
          flags: backend

  # Security scanning
  security-scan:
    name: Security Scan
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          format: 'sarif'
          output: 'trivy-results.sarif'
      
      - name: Upload Trivy results to GitHub Security
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'
      
      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high

  # Docker build
  docker-build:
    name: Docker Build
    runs-on: ubuntu-latest
    needs: [backend-ci, security-scan]
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Build Docker image
        uses: docker/build-push-action@v5
        with:
          context: ./backend
          push: false
          tags: estaie/api-gateway:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

#### 2. CD Workflow (Deploy to Staging)

```yaml
# .github/workflows/deploy-staging.yml
name: Deploy to Staging

on:
  push:
    branches: [main]

env:
  GCP_PROJECT: estaie-staging
  GCP_REGION: us-central1
  SERVICE_NAME: api-gateway

jobs:
  deploy-backend:
    name: Deploy Backend to Cloud Run
    runs-on: ubuntu-latest
    
    permissions:
      contents: read
      id-token: write
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
      
      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2
      
      - name: Configure Docker for GCR
        run: gcloud auth configure-docker
      
      - name: Build and push Docker image
        run: |
          docker build -t gcr.io/${{ env.GCP_PROJECT }}/${{ env.SERVICE_NAME }}:${{ github.sha }} ./backend
          docker push gcr.io/${{ env.GCP_PROJECT }}/${{ env.SERVICE_NAME }}:${{ github.sha }}
      
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy ${{ env.SERVICE_NAME }} \
            --image gcr.io/${{ env.GCP_PROJECT }}/${{ env.SERVICE_NAME }}:${{ github.sha }} \
            --region ${{ env.GCP_REGION }} \
            --platform managed \
            --allow-unauthenticated \
            --min-instances 2 \
            --max-instances 100 \
            --cpu 2 \
            --memory 2Gi \
            --timeout 300 \
            --concurrency 80 \
            --set-env-vars "NODE_ENV=staging" \
            --set-secrets "DATABASE_URL=database-url:latest,STRIPE_SECRET_KEY=stripe-secret:latest"
      
      - name: Run database migrations
        run: |
          gcloud run jobs execute migrate-database \
            --region ${{ env.GCP_REGION }} \
            --wait
      
      - name: Verify deployment
        run: |
          SERVICE_URL=$(gcloud run services describe ${{ env.SERVICE_NAME }} \
            --region ${{ env.GCP_REGION }} \
            --format 'value(status.url)')
          
          curl -f $SERVICE_URL/health || exit 1

  deploy-frontend:
    name: Deploy Frontend to Vercel
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: ./frontend
          scope: ${{ secrets.VERCEL_ORG_ID }}

  e2e-tests:
    name: E2E Tests
    runs-on: ubuntu-latest
    needs: [deploy-backend, deploy-frontend]
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install Playwright
        run: |
          cd e2e
          npm ci
          npx playwright install --with-deps
      
      - name: Run E2E tests
        run: |
          cd e2e
          npm run test
        env:
          BASE_URL: https://staging.estaie.com
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: e2e/playwright-report/

  load-tests:
    name: Load Tests
    runs-on: ubuntu-latest
    needs: [e2e-tests]
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Run k6 load test
        uses: grafana/k6-action@v0.3.1
        with:
          filename: load-tests/booking-flow.js
        env:
          K6_CLOUD_TOKEN: ${{ secrets.K6_CLOUD_TOKEN }}
          BASE_URL: https://staging-api.estaie.com
      
      - name: Check performance thresholds
        run: |
          # Fail if P95 latency > 500ms
          if [ $(cat k6-results.json | jq '.metrics.http_req_duration.values.p95') -gt 500 ]; then
            echo "Performance regression detected"
            exit 1
          fi
```

---

#### 3. Production Deployment (Canary)

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment strategy'
        required: true
        type: choice
        options:
          - canary-5
          - canary-25
          - canary-50
          - full-rollout

jobs:
  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    environment: production
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
      
      - name: Deploy canary
        if: startsWith(github.event.inputs.environment, 'canary')
        run: |
          # Extract percentage from input (e.g., "canary-5" -> 5)
          PERCENTAGE=$(echo ${{ github.event.inputs.environment }} | cut -d'-' -f2)
          
          # Deploy new revision with tag
          gcloud run deploy api-gateway \
            --image gcr.io/estaie-prod/api-gateway:${{ github.sha }} \
            --region us-central1 \
            --no-traffic \
            --tag canary
          
          # Split traffic
          gcloud run services update-traffic api-gateway \
            --region us-central1 \
            --to-revisions canary=$PERCENTAGE,LATEST=$((100-PERCENTAGE))
      
      - name: Monitor canary metrics
        if: startsWith(github.event.inputs.environment, 'canary')
        run: |
          # Wait 10 minutes and check metrics
          sleep 600
          
          # Check error rate
          ERROR_RATE=$(gcloud monitoring time-series list \
            --filter 'metric.type="run.googleapis.com/request_count" AND metric.label.response_code_class="5xx"' \
            --format json | jq '.[] | .points[0].value.int64Value')
          
          if [ $ERROR_RATE -gt 10 ]; then
            echo "High error rate detected, rolling back"
            gcloud run services update-traffic api-gateway \
              --region us-central1 \
              --to-latest
            exit 1
          fi
      
      - name: Full rollout
        if: github.event.inputs.environment == 'full-rollout'
        run: |
          gcloud run services update-traffic api-gateway \
            --region us-central1 \
            --to-latest
      
      - name: Notify Slack
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "Production deployment: ${{ github.event.inputs.environment }}",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "🚀 *Production Deployment*\n*Strategy:* ${{ github.event.inputs.environment }}\n*Commit:* ${{ github.sha }}\n*Actor:* ${{ github.actor }}"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

### Database Migration Strategy

```yaml
# .github/workflows/migrate-database.yml
name: Database Migration

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - staging
          - production

jobs:
  migrate:
    name: Run Database Migration
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
      
      - name: Setup Cloud SQL Proxy
        run: |
          wget https://dl.google.com/cloudsql/cloud_sql_proxy.linux.amd64 -O cloud_sql_proxy
          chmod +x cloud_sql_proxy
          ./cloud_sql_proxy -instances=${{ secrets.CLOUD_SQL_INSTANCE }}=tcp:5432 &
          sleep 5
      
      - name: Backup database
        run: |
          pg_dump -h localhost -U postgres -d estaie > backup-$(date +%Y%m%d-%H%M%S).sql
          gsutil cp backup-*.sql gs://estaie-backups/migrations/
      
      - name: Run migrations
        run: |
          cd backend
          npm ci
          npm run migration:run
        env:
          DATABASE_URL: postgresql://postgres:${{ secrets.DB_PASSWORD }}@localhost:5432/estaie
      
      - name: Verify migration
        run: |
          cd backend
          npm run migration:show
      
      - name: Rollback on failure
        if: failure()
        run: |
          cd backend
          npm run migration:revert
```

---

## Observability Stack

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Application Layer                             │
│  • Cloud Run services                                            │
│  • Next.js frontend                                              │
│  • Go microservices                                              │
└────────────────────┬─────────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   LOGGING    │ │   METRICS    │ │   TRACING    │
│              │ │              │ │              │
│ Cloud        │ │ Cloud        │ │ Cloud        │
│ Logging      │ │ Monitoring   │ │ Trace        │
│              │ │              │ │              │
│ + Sentry     │ │ + Prometheus │ │ + Jaeger     │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │   Visualization & Alerting    │
        │                               │
        │  • Grafana dashboards         │
        │  • Cloud Monitoring alerts    │
        │  • Slack notifications         │
        │  • PagerDuty incidents        │
        └───────────────────────────────┘
```

---

### 1. Logging (Cloud Logging + Sentry)

#### Structured Logging

```typescript
// logger.service.ts
import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { Logging } from '@google-cloud/logging';
import * as Sentry from '@sentry/node';

@Injectable()
export class LoggerService implements NestLoggerService {
  private logging: Logging;
  private log: any;

  constructor() {
    this.logging = new Logging();
    this.log = this.logging.log('api-gateway');
  }

  log(message: string, context?: string, metadata?: any) {
    this.writeLog('INFO', message, context, metadata);
  }

  error(message: string, trace?: string, context?: string, metadata?: any) {
    this.writeLog('ERROR', message, context, { ...metadata, trace });
    
    // Send to Sentry
    Sentry.captureException(new Error(message), {
      contexts: { context: { name: context } },
      extra: metadata,
    });
  }

  warn(message: string, context?: string, metadata?: any) {
    this.writeLog('WARNING', message, context, metadata);
  }

  debug(message: string, context?: string, metadata?: any) {
    if (process.env.NODE_ENV === 'development') {
      this.writeLog('DEBUG', message, context, metadata);
    }
  }

  private async writeLog(
    severity: string,
    message: string,
    context?: string,
    metadata?: any,
  ) {
    const entry = this.log.entry(
      {
        severity,
        resource: {
          type: 'cloud_run_revision',
          labels: {
            service_name: process.env.SERVICE_NAME,
            revision_name: process.env.K_REVISION,
          },
        },
      },
      {
        message,
        context,
        ...metadata,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        version: process.env.APP_VERSION,
      },
    );

    await this.log.write(entry);

    // Also log to console for local development
    if (process.env.NODE_ENV === 'development') {
      console.log(JSON.stringify({ severity, message, context, metadata }, null, 2));
    }
  }
}

// Usage in controllers
@Controller('bookings')
export class BookingsController {
  constructor(private logger: LoggerService) {}

  @Post()
  async createBooking(@Body() dto: CreateBookingDto) {
    this.logger.log('Creating booking', 'BookingsController', {
      userId: dto.userId,
      propertyId: dto.propertyId,
    });

    try {
      const booking = await this.bookingService.create(dto);
      
      this.logger.log('Booking created successfully', 'BookingsController', {
        bookingId: booking.id,
        duration: Date.now() - startTime,
      });

      return booking;
    } catch (error) {
      this.logger.error(
        'Failed to create booking',
        error.stack,
        'BookingsController',
        {
          userId: dto.userId,
          error: error.message,
        },
      );
      throw error;
    }
  }
}
```

---

### 2. Metrics (Cloud Monitoring + Prometheus)

#### Custom Metrics

```typescript
// metrics.service.ts
import { Injectable } from '@nestjs/common';
import { MetricServiceClient } from '@google-cloud/monitoring';
import { Counter, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  private metricClient: MetricServiceClient;
  private registry: Registry;
  
  // Prometheus metrics
  private httpRequestDuration: Histogram;
  private httpRequestTotal: Counter;
  private bookingCreated: Counter;
  private paymentProcessed: Counter;

  constructor() {
    this.metricClient = new MetricServiceClient();
    this.registry = new Registry();
    
    // HTTP request duration
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    // HTTP request total
    this.httpRequestTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    // Business metrics
    this.bookingCreated = new Counter({
      name: 'bookings_created_total',
      help: 'Total number of bookings created',
      labelNames: ['property_type', 'region'],
      registers: [this.registry],
    });

    this.paymentProcessed = new Counter({
      name: 'payments_processed_total',
      help: 'Total number of payments processed',
      labelNames: ['status', 'provider'],
      registers: [this.registry],
    });
  }

  // Record HTTP request
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
  ) {
    this.httpRequestDuration
      .labels(method, route, statusCode.toString())
      .observe(duration);
    
    this.httpRequestTotal
      .labels(method, route, statusCode.toString())
      .inc();
  }

  // Record booking creation
  recordBookingCreated(propertyType: string, region: string) {
    this.bookingCreated.labels(propertyType, region).inc();
  }

  // Record payment
  recordPaymentProcessed(status: string, provider: string) {
    this.paymentProcessed.labels(status, provider).inc();
  }

  // Write custom metric to Cloud Monitoring
  async writeCustomMetric(metricType: string, value: number, labels: Record<string, string>) {
    const projectId = process.env.GCP_PROJECT;
    const dataPoint = {
      interval: {
        endTime: {
          seconds: Date.now() / 1000,
        },
      },
      value: {
        doubleValue: value,
      },
    };

    const timeSeriesData = {
      metric: {
        type: `custom.googleapis.com/${metricType}`,
        labels,
      },
      resource: {
        type: 'cloud_run_revision',
        labels: {
          service_name: process.env.SERVICE_NAME,
          revision_name: process.env.K_REVISION,
          location: process.env.GCP_REGION,
        },
      },
      points: [dataPoint],
    };

    const request = {
      name: this.metricClient.projectPath(projectId),
      timeSeries: [timeSeriesData],
    };

    await this.metricClient.createTimeSeries(request);
  }

  // Expose metrics for Prometheus scraping
  getMetrics(): string {
    return this.registry.metrics();
  }
}

// Metrics middleware
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();

    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      this.metrics.recordHttpRequest(
        req.method,
        req.route?.path || req.path,
        res.statusCode,
        duration,
      );
    });

    next();
  }
}
```

---

### 3. Distributed Tracing (Cloud Trace + OpenTelemetry)

```typescript
// tracing.ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4';
import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export function setupTracing() {
  const provider = new NodeTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
    }),
  });

  // Export to Cloud Trace
  const exporter = new TraceExporter();
  provider.addSpanProcessor(
    new BatchSpanProcessor(exporter, {
      maxQueueSize: 1000,
      scheduledDelayMillis: 5000,
    }),
  );

  // Auto-instrument libraries
  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation(),
      new RedisInstrumentation(),
    ],
  });

  provider.register();
}

// Custom spans
import { trace } from '@opentelemetry/api';

async function processBooking(booking: Booking) {
  const tracer = trace.getTracer('booking-service');
  const span = tracer.startSpan('process_booking');

  try {
    span.setAttribute('booking.id', booking.id);
    span.setAttribute('booking.property_id', booking.propertyId);
    
    // Child span for database operation
    const dbSpan = tracer.startSpan('database.insert_booking', {
      parent: span,
    });
    await db.bookings.insert(booking);
    dbSpan.end();

    // Child span for payment
    const paymentSpan = tracer.startSpan('payment.create_intent', {
      parent: span,
    });
    await paymentService.createIntent(booking);
    paymentSpan.end();

    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    throw error;
  } finally {
    span.end();
  }
}
```

---

### 4. Alerting Rules

```yaml
# alerting-rules.yml
groups:
  - name: api_gateway
    interval: 30s
    rules:
      # High error rate
      - alert: HighErrorRate
        expr: |
          (
            sum(rate(http_requests_total{status_code=~"5.."}[5m]))
            /
            sum(rate(http_requests_total[5m]))
          ) > 0.05
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} (threshold: 5%)"
      
      # High latency
      - alert: HighLatency
        expr: |
          histogram_quantile(0.95,
            sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
          ) > 0.5
        for: 10m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "High API latency"
          description: "P95 latency is {{ $value }}s (threshold: 0.5s)"
      
      # Database connection pool exhausted
      - alert: DatabasePoolExhausted
        expr: |
          (
            sum(database_connections_active)
            /
            sum(database_connections_max)
          ) > 0.9
        for: 5m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Database connection pool near capacity"
          description: "Pool usage is {{ $value | humanizePercentage }}"
      
      # Redis memory high
      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.9
        for: 10m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Redis memory usage high"
          description: "Memory usage is {{ $value | humanizePercentage }}"
      
      # Failed payment rate
      - alert: HighPaymentFailureRate
        expr: |
          (
            sum(rate(payments_processed_total{status="failed"}[10m]))
            /
            sum(rate(payments_processed_total[10m]))
          ) > 0.1
        for: 5m
        labels:
          severity: critical
          team: payments
        annotations:
          summary: "High payment failure rate"
          description: "Payment failure rate is {{ $value | humanizePercentage }}"
      
      # Cloud Run instance count
      - alert: CloudRunScalingIssue
        expr: cloud_run_instance_count > 900
        for: 5m
        labels:
          severity: warning
          team: devops
        annotations:
          summary: "Cloud Run approaching max instances"
          description: "Instance count is {{ $value }} (max: 1000)"
```

---

### 5. Grafana Dashboards

```json
{
  "dashboard": {
    "title": "estaie API Gateway",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total[5m])) by (status_code)",
            "legendFormat": "{{status_code}}"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Latency (P50, P95, P99)",
        "targets": [
          {
            "expr": "histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))",
            "legendFormat": "P50"
          },
          {
            "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))",
            "legendFormat": "P95"
          },
          {
            "expr": "histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))",
            "legendFormat": "P99"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Error Rate",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total{status_code=~\"5..\"}[5m])) / sum(rate(http_requests_total[5m]))",
            "legendFormat": "Error Rate"
          }
        ],
        "type": "graph",
        "thresholds": [
          {
            "value": 0.01,
            "color": "yellow"
          },
          {
            "value": 0.05,
            "color": "red"
          }
        ]
      },
      {
        "title": "Bookings Created",
        "targets": [
          {
            "expr": "sum(rate(bookings_created_total[5m])) by (region)",
            "legendFormat": "{{region}}"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Database Query Duration",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, sum(rate(database_query_duration_seconds_bucket[5m])) by (le, query_type))",
            "legendFormat": "{{query_type}} P95"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Redis Operations",
        "targets": [
          {
            "expr": "sum(rate(redis_commands_total[5m])) by (command)",
            "legendFormat": "{{command}}"
          }
        ],
        "type": "graph"
      }
    ]
  }
}
```

---

## Security Architecture

### 1. Network Security

```
┌─────────────────────────────────────────────────────────────────┐
│                    Internet (Public)                             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare (Layer 7)                                            │
│  • WAF rules (OWASP Top 10)                                      │
│  • DDoS protection (L3/L4/L7)                                    │
│  • Bot management                                                │
│  • Rate limiting (per IP, per user)                              │
│  • SSL/TLS termination                                           │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloud Load Balancer                                             │
│  • Cloud Armor (DDoS protection)                                 │
│  • SSL policies (TLS 1.2+)                                       │
│  • Backend service health checks                                 │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloud Run (API Gateway)                                         │
│  • Ingress: Internal + Cloud Load Balancing                      │
│  • Authentication: JWT + OAuth2.0                                │
│  • Authorization: RBAC + ABAC                                    │
│  • Request validation: Zod schemas                               │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  VPC (Private Network)                                           │
│  • Cloud SQL (Private IP)                                        │
│  • Redis (Private IP)                                            │
│  • Internal services (gRPC)                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

### 2. Authentication & Authorization

```typescript
// auth.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Extract JWT from Authorization header
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    try {
      // Verify JWT
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });

      // Attach user to request
      request.user = payload;

      // Check permissions
      const requiredPermissions = this.reflector.get<string[]>(
        'permissions',
        context.getHandler(),
      );

      if (requiredPermissions) {
        return this.checkPermissions(payload, requiredPermissions);
      }

      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid authentication token');
    }
  }

  private extractToken(request: any): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) return null;

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : null;
  }

  private checkPermissions(user: any, requiredPermissions: string[]): boolean {
    return requiredPermissions.every((permission) =>
      user.permissions?.includes(permission),
    );
  }
}

// Usage
@Controller('bookings')
@UseGuards(AuthGuard)
export class BookingsController {
  @Post()
  @Permissions('bookings:create')
  async createBooking(@Body() dto: CreateBookingDto, @User() user: JwtPayload) {
    return this.bookingService.create(dto, user.userId);
  }

  @Get(':id')
  @Permissions('bookings:read')
  async getBooking(@Param('id') id: string, @User() user: JwtPayload) {
    const booking = await this.bookingService.findById(id);
    
    // Resource-level authorization
    if (booking.userId !== user.userId && !user.permissions.includes('bookings:read:all')) {
      throw new ForbiddenException('Access denied');
    }

    return booking;
  }
}
```

---

### 3. Secrets Management

```typescript
// secrets.service.ts
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

@Injectable()
export class SecretsService {
  private client: SecretManagerServiceClient;

  constructor() {
    this.client = new SecretManagerServiceClient();
  }

  async getSecret(secretName: string): Promise<string> {
    const projectId = process.env.GCP_PROJECT;
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;

    const [version] = await this.client.accessSecretVersion({ name });
    return version.payload.data.toString();
  }

  // Cache secrets in memory (refresh every hour)
  private secretsCache = new Map<string, { value: string; expiresAt: number }>();

  async getCachedSecret(secretName: string): Promise<string> {
    const cached = this.secretsCache.get(secretName);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await this.getSecret(secretName);
    this.secretsCache.set(secretName, {
      value,
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    return value;
  }
}

// Usage in main.ts
async function bootstrap() {
  const secretsService = new SecretsService();
  
  // Load secrets at startup
  process.env.DATABASE_URL = await secretsService.getSecret('database-url');
  process.env.STRIPE_SECRET_KEY = await secretsService.getSecret('stripe-secret');
  process.env.JWT_SECRET = await secretsService.getSecret('jwt-secret');

  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT || 8080);
}
```

---

### 4. Input Validation & Sanitization

```typescript
// validation.pipe.ts
import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: z.ZodSchema) {}

  transform(value: any) {
    try {
      // Sanitize strings
      const sanitized = this.sanitizeObject(value);
      
      // Validate with Zod
      return this.schema.parse(sanitized);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: error.errors,
        });
      }
      throw error;
    }
  }

  private sanitizeObject(obj: any): any {
    if (typeof obj === 'string') {
      return DOMPurify.sanitize(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item));
    }
    if (obj !== null && typeof obj === 'object') {
      return Object.keys(obj).reduce((acc, key) => {
        acc[key] = this.sanitizeObject(obj[key]);
        return acc;
      }, {});
    }
    return obj;
  }
}

// Schemas
const CreateBookingSchema = z.object({
  propertyId: z.string().uuid(),
  checkIn: z.string().datetime(),
  checkOut: z.string().datetime(),
  guests: z.number().int().min(1).max(20),
  specialRequests: z.string().max(500).optional(),
});

// Usage
@Post()
async createBooking(
  @Body(new ZodValidationPipe(CreateBookingSchema)) dto: CreateBookingDto,
) {
  return this.bookingService.create(dto);
}
```

---

### 5. Rate Limiting

```typescript
// rate-limit.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = this.getRateLimitKey(request);

    // Token bucket algorithm
    const limit = 100; // requests per minute
    const window = 60; // seconds

    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, window);
    }

    if (current > limit) {
      throw new TooManyRequestsException('Rate limit exceeded');
    }

    return true;
  }

  private getRateLimitKey(request: any): string {
    // Rate limit by user ID (if authenticated) or IP address
    const userId = request.user?.userId;
    const ip = request.ip;
    return `rate-limit:${userId || ip}:${Math.floor(Date.now() / 60000)}`;
  }
}
```

---

## Production Readiness Checklist

### Infrastructure

- [ ] **Multi-region deployment** (UAE, KSA, UK)
- [ ] **Auto-scaling configured** (min 10, max 1000 instances)
- [ ] **Load balancer health checks** (every 5s, 2 failures = unhealthy)
- [ ] **Database backups** (automated daily, 30-day retention)
- [ ] **Disaster recovery plan** (RTO: 1 hour, RPO: 5 minutes)
- [ ] **SSL/TLS certificates** (auto-renewal via Let's Encrypt)
- [ ] **CDN configured** (Cloudflare + Cloud CDN)
- [ ] **DNS failover** (health-based routing)

### Security

- [ ] **WAF rules enabled** (OWASP Top 10)
- [ ] **DDoS protection** (Cloudflare + Cloud Armor)
- [ ] **Secrets in Secret Manager** (no hardcoded credentials)
- [ ] **IAM least privilege** (service accounts per service)
- [ ] **Network isolation** (VPC, private IPs for databases)
- [ ] **Encryption at rest** (Cloud SQL, Cloud Storage)
- [ ] **Encryption in transit** (TLS 1.2+)
- [ ] **Security scanning** (Trivy, Snyk in CI/CD)
- [ ] **Penetration testing** (annual third-party audit)
- [ ] **Compliance** (GDPR, PDPL, PCI DSS)

### Observability

- [ ] **Structured logging** (Cloud Logging + Sentry)
- [ ] **Metrics collection** (Prometheus + Cloud Monitoring)
- [ ] **Distributed tracing** (Cloud Trace + OpenTelemetry)
- [ ] **Dashboards** (Grafana for ops, Looker for business)
- [ ] **Alerting rules** (error rate, latency, saturation)
- [ ] **On-call rotation** (PagerDuty integration)
- [ ] **Runbooks** (documented incident response)
- [ ] **SLIs/SLOs defined** (99.9% uptime, P95 < 500ms)

### Testing

- [ ] **Unit tests** (>80% coverage)
- [ ] **Integration tests** (API endpoints, database)
- [ ] **E2E tests** (Playwright, critical user flows)
- [ ] **Load tests** (k6, 1K bookings/sec sustained)
- [ ] **Chaos engineering** (monthly in staging)
- [ ] **Security tests** (OWASP ZAP, SQL injection)
- [ ] **Performance tests** (Lighthouse, Core Web Vitals)

### Deployment

- [ ] **Zero-downtime deployment** (rolling updates)
- [ ] **Canary releases** (5% → 25% → 100%)
- [ ] **Feature flags** (Statsig for gradual rollout)
- [ ] **Rollback plan** (automated on error spike)
- [ ] **Database migrations** (backward compatible, tested)
- [ ] **Smoke tests** (post-deployment verification)
- [ ] **Blue-green deployment** (for major releases)

### Documentation

- [ ] **API documentation** (OpenAPI/Swagger)
- [ ] **Architecture diagrams** (system, data flow, deployment)
- [ ] **Runbooks** (incident response, common issues)
- [ ] **Onboarding guide** (for new engineers)
- [ ] **Deployment guide** (step-by-step instructions)
- [ ] **Troubleshooting guide** (common errors, solutions)
- [ ] **Postmortems** (incident analysis, action items)

### Compliance

- [ ] **GDPR compliance** (data residency, right to deletion)
- [ ] **PCI DSS** (payment data handling)
- [ ] **PDPL (UAE/KSA)** (local data storage)
- [ ] **SOC 2** (security controls, annual audit)
- [ ] **ISO 27001** (information security management)
- [ ] **Data retention policies** (GDPR: 7 years for financial data)
- [ ] **Privacy policy** (user consent, data usage)
- [ ] **Terms of service** (legal agreements)

---

**Next:** [Leadership & Execution Plan →](./04-leadership-execution.md)

