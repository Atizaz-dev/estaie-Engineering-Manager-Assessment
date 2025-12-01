# 2. Transaction Integrity (20%)

## Table of Contents
1. [Booking Atomicity Pattern](#booking-atomicity-pattern)
2. [Idempotent Payment Processing](#idempotent-payment-processing)
3. [Recovery & Retry Logic](#recovery--retry-logic)
4. [Double-Booking Prevention](#double-booking-prevention)
5. [Distributed Transaction Patterns](#distributed-transaction-patterns)

---

## Booking Atomicity Pattern

### Challenge

In a distributed system, a booking involves multiple operations across different services:
1. **Inventory Service:** Check availability, reserve unit
2. **Booking Service:** Create booking record
3. **Payment Service:** Process payment
4. **Partner Service:** Sync with external PMS
5. **Notification Service:** Send confirmation

**Problem:** How do we ensure all operations succeed or fail together (atomicity) without distributed transactions (2PC)?

---

### Solution: Saga Pattern + Outbox Pattern

#### Saga Pattern (Choreography-based)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Booking Saga (Happy Path)                     │
└─────────────────────────────────────────────────────────────────┘

1. User initiates booking
   ↓
2. Booking Service
   ├─→ Acquire distributed lock (Redis)
   ├─→ Validate request (dates, property, user)
   ├─→ Create booking (status: PENDING_PAYMENT)
   ├─→ Publish: booking.created
   └─→ Return: booking_id + payment_url
   ↓
3. Inventory Service (subscribes to booking.created)
   ├─→ Check availability
   ├─→ Create soft reservation (15 min TTL)
   ├─→ Publish: inventory.reserved
   └─→ If unavailable → Publish: inventory.unavailable
   ↓
4. Payment Service (subscribes to inventory.reserved)
   ├─→ Create Stripe payment intent (idempotency_key)
   ├─→ Store payment record (status: PENDING)
   ├─→ Publish: payment.initiated
   └─→ Return payment URL to user
   ↓
5. User completes payment (Stripe webhook)
   ↓
6. Payment Service (webhook handler)
   ├─→ Verify webhook signature
   ├─→ Update payment (status: COMPLETED)
   ├─→ Publish: payment.completed
   └─→ Release distributed lock
   ↓
7. Booking Service (subscribes to payment.completed)
   ├─→ Update booking (status: CONFIRMED)
   ├─→ Publish: booking.confirmed
   └─→ Store in outbox table
   ↓
8. Inventory Service (subscribes to booking.confirmed)
   ├─→ Convert soft → hard reservation
   ├─→ Decrement available inventory
   └─→ Publish: inventory.updated
   ↓
9. Partner Sync Service (subscribes to booking.confirmed)
   ├─→ Transform booking data
   ├─→ Send to partner API (with retry)
   └─→ Update sync status
   ↓
10. Notification Service (subscribes to booking.confirmed)
    ├─→ Send confirmation email
    ├─→ Send WhatsApp message
    └─→ Send push notification
```

#### Compensating Transactions (Failure Path)

```
┌─────────────────────────────────────────────────────────────────┐
│                Booking Saga (Failure Path)                       │
└─────────────────────────────────────────────────────────────────┘

Scenario 1: Payment fails
1. Payment Service publishes: payment.failed
   ↓
2. Booking Service (subscribes to payment.failed)
   ├─→ Update booking (status: CANCELLED)
   ├─→ Publish: booking.cancelled
   └─→ Release distributed lock
   ↓
3. Inventory Service (subscribes to booking.cancelled)
   ├─→ Release soft reservation
   └─→ Publish: inventory.released

Scenario 2: Inventory unavailable
1. Inventory Service publishes: inventory.unavailable
   ↓
2. Booking Service (subscribes to inventory.unavailable)
   ├─→ Update booking (status: FAILED)
   ├─→ Publish: booking.failed
   └─→ Release distributed lock
   ↓
3. User receives: "Property unavailable" error

Scenario 3: Payment timeout (15 min)
1. Cloud Task triggers: booking.timeout
   ↓
2. Booking Service (timeout handler)
   ├─→ Check payment status
   ├─→ If still PENDING → Cancel booking
   ├─→ Publish: booking.cancelled
   └─→ Release distributed lock
   ↓
3. Inventory Service releases reservation
```

---

### Implementation: Booking Service

```typescript
// booking.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PubSub } from '@google-cloud/pubsub';
import { Redis } from 'ioredis';

@Injectable()
export class BookingService {
  constructor(
    @InjectRepository(Booking)
    private bookingRepo: Repository<Booking>,
    @InjectRepository(OutboxEvent)
    private outboxRepo: Repository<OutboxEvent>,
    private dataSource: DataSource,
    private pubsub: PubSub,
    private redis: Redis,
  ) {}

  async createBooking(dto: CreateBookingDto): Promise<BookingResponse> {
    const lockKey = `booking:${dto.propertyId}:${dto.checkIn}:${dto.checkOut}`;
    const lock = await this.acquireLock(lockKey, 30000); // 30s lock

    try {
      // Start database transaction
      return await this.dataSource.transaction(async (manager) => {
        // 1. Create booking record
        const booking = manager.create(Booking, {
          userId: dto.userId,
          propertyId: dto.propertyId,
          checkIn: dto.checkIn,
          checkOut: dto.checkOut,
          guests: dto.guests,
          totalAmount: dto.totalAmount,
          status: BookingStatus.PENDING_PAYMENT,
          createdAt: new Date(),
        });
        await manager.save(booking);

        // 2. Create outbox event (for guaranteed delivery)
        const outboxEvent = manager.create(OutboxEvent, {
          aggregateId: booking.id,
          aggregateType: 'Booking',
          eventType: 'booking.created',
          payload: {
            bookingId: booking.id,
            userId: booking.userId,
            propertyId: booking.propertyId,
            checkIn: booking.checkIn,
            checkOut: booking.checkOut,
            totalAmount: booking.totalAmount,
          },
          status: 'PENDING',
          createdAt: new Date(),
        });
        await manager.save(outboxEvent);

        // 3. Publish event (async, best-effort)
        // Note: Outbox processor will retry if this fails
        await this.publishEvent('booking.created', outboxEvent.payload);

        // 4. Schedule timeout task (15 min)
        await this.scheduleTimeout(booking.id, 15 * 60 * 1000);

        return {
          bookingId: booking.id,
          status: booking.status,
          paymentUrl: this.generatePaymentUrl(booking.id),
        };
      });
    } finally {
      await this.releaseLock(lock);
    }
  }

  async confirmBooking(bookingId: string, paymentId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // 1. Update booking status
      const booking = await manager.findOne(Booking, { where: { id: bookingId } });
      if (!booking) throw new NotFoundException('Booking not found');
      
      if (booking.status !== BookingStatus.PENDING_PAYMENT) {
        throw new ConflictException('Booking already processed');
      }

      booking.status = BookingStatus.CONFIRMED;
      booking.paymentId = paymentId;
      booking.confirmedAt = new Date();
      await manager.save(booking);

      // 2. Create outbox event
      const outboxEvent = manager.create(OutboxEvent, {
        aggregateId: booking.id,
        aggregateType: 'Booking',
        eventType: 'booking.confirmed',
        payload: {
          bookingId: booking.id,
          userId: booking.userId,
          propertyId: booking.propertyId,
          paymentId: paymentId,
          confirmedAt: booking.confirmedAt,
        },
        status: 'PENDING',
        createdAt: new Date(),
      });
      await manager.save(outboxEvent);

      // 3. Publish event
      await this.publishEvent('booking.confirmed', outboxEvent.payload);
    });
  }

  private async acquireLock(key: string, ttl: number): Promise<Lock> {
    const lockValue = crypto.randomUUID();
    const acquired = await this.redis.set(key, lockValue, 'PX', ttl, 'NX');
    
    if (!acquired) {
      throw new ConflictException('Resource locked - concurrent booking detected');
    }

    return { key, value: lockValue };
  }

  private async releaseLock(lock: Lock): Promise<void> {
    // Lua script for atomic check-and-delete
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, lock.key, lock.value);
  }

  private async publishEvent(topic: string, payload: any): Promise<void> {
    const messageId = await this.pubsub.topic(topic).publishMessage({
      json: payload,
      attributes: {
        eventType: topic,
        timestamp: new Date().toISOString(),
      },
    });
    console.log(`Published ${topic} with message ID: ${messageId}`);
  }

  private async scheduleTimeout(bookingId: string, delayMs: number): Promise<void> {
    const cloudTasks = new CloudTasksClient();
    const project = process.env.GCP_PROJECT;
    const location = process.env.GCP_REGION;
    const queue = 'booking-timeouts';

    const task = {
      httpRequest: {
        httpMethod: 'POST',
        url: `${process.env.API_URL}/bookings/${bookingId}/timeout`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify({ bookingId })).toString('base64'),
      },
      scheduleTime: {
        seconds: Date.now() / 1000 + delayMs / 1000,
      },
    };

    await cloudTasks.createTask({
      parent: cloudTasks.queuePath(project, location, queue),
      task,
    });
  }
}
```

---

### Outbox Pattern (Guaranteed Event Delivery)

#### Database Schema

```sql
-- Outbox table for guaranteed event delivery
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP,
  error_message TEXT,
  
  INDEX idx_status_created (status, created_at),
  INDEX idx_aggregate (aggregate_type, aggregate_id)
);

-- Booking table
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  property_id UUID NOT NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  guests INT NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) NOT NULL,
  payment_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  
  INDEX idx_user (user_id),
  INDEX idx_property_dates (property_id, check_in, check_out),
  INDEX idx_status (status),
  
  CONSTRAINT chk_dates CHECK (check_out > check_in),
  CONSTRAINT chk_guests CHECK (guests > 0)
);

-- Idempotency table (prevent duplicate requests)
CREATE TABLE idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  request_hash VARCHAR(64) NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  
  INDEX idx_expires (expires_at)
);
```

#### Outbox Processor (Background Worker)

```typescript
// outbox-processor.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { PubSub } from '@google-cloud/pubsub';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class OutboxProcessorService implements OnModuleInit {
  constructor(
    @InjectRepository(OutboxEvent)
    private outboxRepo: Repository<OutboxEvent>,
    private pubsub: PubSub,
  ) {}

  onModuleInit() {
    // Start processing immediately
    this.processOutboxEvents();
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutboxEvents(): Promise<void> {
    // Fetch pending events (with exponential backoff)
    const events = await this.outboxRepo.find({
      where: {
        status: 'PENDING',
        retryCount: LessThan(5), // Max 5 retries
      },
      order: { createdAt: 'ASC' },
      take: 100, // Process in batches
    });

    for (const event of events) {
      try {
        // Publish to Pub/Sub
        const messageId = await this.pubsub
          .topic(event.eventType)
          .publishMessage({
            json: event.payload,
            attributes: {
              eventType: event.eventType,
              aggregateId: event.aggregateId,
              timestamp: event.createdAt.toISOString(),
            },
          });

        // Mark as processed
        event.status = 'PROCESSED';
        event.processedAt = new Date();
        await this.outboxRepo.save(event);

        console.log(`Processed outbox event ${event.id}, message ID: ${messageId}`);
      } catch (error) {
        // Increment retry count
        event.retryCount += 1;
        event.errorMessage = error.message;

        // Mark as failed after max retries
        if (event.retryCount >= 5) {
          event.status = 'FAILED';
          // Send alert to operations team
          await this.sendAlert(`Outbox event ${event.id} failed after 5 retries`);
        }

        await this.outboxRepo.save(event);
        console.error(`Failed to process outbox event ${event.id}:`, error);
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupOldEvents(): Promise<void> {
    // Delete processed events older than 7 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);

    await this.outboxRepo.delete({
      status: 'PROCESSED',
      processedAt: LessThan(cutoffDate),
    });
  }

  private async sendAlert(message: string): Promise<void> {
    // Send to Slack, PagerDuty, etc.
    console.error(`ALERT: ${message}`);
  }
}
```

---

## Idempotent Payment Processing

### Challenge

Payment webhooks can be delivered multiple times due to:
- Network retries
- Webhook provider retries
- Duplicate events

**Problem:** How do we ensure a payment is processed exactly once?

---

### Solution: Idempotency Keys + Request Deduplication

#### Implementation: Payment Service

```typescript
// payment.service.ts
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { createHash } from 'crypto';

@Injectable()
export class PaymentService {
  private stripe: Stripe;

  constructor(
    @InjectRepository(Payment)
    private paymentRepo: Repository<Payment>,
    @InjectRepository(IdempotencyKey)
    private idempotencyRepo: Repository<IdempotencyKey>,
    private dataSource: DataSource,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
    });
  }

  async createPaymentIntent(
    dto: CreatePaymentDto,
    idempotencyKey: string,
  ): Promise<PaymentResponse> {
    // 1. Check idempotency key
    const existingResponse = await this.checkIdempotency(idempotencyKey, dto);
    if (existingResponse) {
      return existingResponse; // Return cached response
    }

    // 2. Create payment intent with Stripe
    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: Math.round(dto.amount * 100), // Convert to cents
        currency: dto.currency,
        metadata: {
          bookingId: dto.bookingId,
          userId: dto.userId,
        },
        automatic_payment_methods: { enabled: true },
      },
      {
        idempotencyKey, // Stripe's built-in idempotency
      },
    );

    // 3. Store payment record
    const payment = await this.dataSource.transaction(async (manager) => {
      const payment = manager.create(Payment, {
        id: paymentIntent.id,
        bookingId: dto.bookingId,
        userId: dto.userId,
        amount: dto.amount,
        currency: dto.currency,
        status: 'PENDING',
        provider: 'stripe',
        providerPaymentId: paymentIntent.id,
        createdAt: new Date(),
      });
      await manager.save(payment);

      // Store idempotency key
      const response = {
        paymentId: payment.id,
        clientSecret: paymentIntent.client_secret,
        status: payment.status,
      };

      await this.storeIdempotency(manager, idempotencyKey, dto, response);

      return response;
    });

    return payment;
  }

  async handleWebhook(
    signature: string,
    payload: Buffer,
  ): Promise<void> {
    // 1. Verify webhook signature
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // 2. Generate idempotency key from event ID
    const idempotencyKey = `webhook:${event.id}`;

    // 3. Check if already processed
    const existing = await this.idempotencyRepo.findOne({
      where: { key: idempotencyKey },
    });
    if (existing) {
      console.log(`Webhook ${event.id} already processed, skipping`);
      return; // Already processed
    }

    // 4. Process webhook
    await this.dataSource.transaction(async (manager) => {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSuccess(manager, event.data.object as Stripe.PaymentIntent);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentFailure(manager, event.data.object as Stripe.PaymentIntent);
          break;
        default:
          console.log(`Unhandled webhook event: ${event.type}`);
      }

      // 5. Store idempotency key
      await manager.save(IdempotencyKey, {
        key: idempotencyKey,
        requestHash: this.hashRequest(event),
        response: { processed: true },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      });
    });
  }

  private async handlePaymentSuccess(
    manager: EntityManager,
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<void> {
    // 1. Update payment status
    const payment = await manager.findOne(Payment, {
      where: { providerPaymentId: paymentIntent.id },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    payment.status = 'COMPLETED';
    payment.completedAt = new Date();
    await manager.save(payment);

    // 2. Create outbox event
    const outboxEvent = manager.create(OutboxEvent, {
      aggregateId: payment.bookingId,
      aggregateType: 'Payment',
      eventType: 'payment.completed',
      payload: {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        amount: payment.amount,
        currency: payment.currency,
      },
      status: 'PENDING',
      createdAt: new Date(),
    });
    await manager.save(outboxEvent);
  }

  private async handlePaymentFailure(
    manager: EntityManager,
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<void> {
    const payment = await manager.findOne(Payment, {
      where: { providerPaymentId: paymentIntent.id },
    });
    if (!payment) return;

    payment.status = 'FAILED';
    payment.failureReason = paymentIntent.last_payment_error?.message;
    await manager.save(payment);

    // Publish failure event
    const outboxEvent = manager.create(OutboxEvent, {
      aggregateId: payment.bookingId,
      aggregateType: 'Payment',
      eventType: 'payment.failed',
      payload: {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        reason: payment.failureReason,
      },
      status: 'PENDING',
      createdAt: new Date(),
    });
    await manager.save(outboxEvent);
  }

  private async checkIdempotency(
    key: string,
    request: any,
  ): Promise<any | null> {
    const existing = await this.idempotencyRepo.findOne({
      where: { key },
    });

    if (!existing) return null;

    // Verify request hash matches (prevent key reuse with different data)
    const requestHash = this.hashRequest(request);
    if (existing.requestHash !== requestHash) {
      throw new ConflictException('Idempotency key reused with different request');
    }

    return existing.response;
  }

  private async storeIdempotency(
    manager: EntityManager,
    key: string,
    request: any,
    response: any,
  ): Promise<void> {
    await manager.save(IdempotencyKey, {
      key,
      requestHash: this.hashRequest(request),
      response,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });
  }

  private hashRequest(request: any): string {
    return createHash('sha256')
      .update(JSON.stringify(request))
      .digest('hex');
  }
}
```

---

## Recovery & Retry Logic

### Retry Strategy

```typescript
// retry.decorator.ts
import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
  retryableErrors?: Array<new (...args: any[]) => Error>;
}

export function Retry(options: RetryOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const logger = new Logger(target.constructor.name);

    descriptor.value = async function (...args: any[]) {
      let lastError: Error;
      let delay = options.initialDelay;

      for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          lastError = error;

          // Check if error is retryable
          if (options.retryableErrors) {
            const isRetryable = options.retryableErrors.some(
              (ErrorClass) => error instanceof ErrorClass,
            );
            if (!isRetryable) throw error;
          }

          // Don't retry on client errors (4xx)
          if (error.statusCode >= 400 && error.statusCode < 500) {
            throw error;
          }

          if (attempt === options.maxAttempts) {
            logger.error(
              `${propertyKey} failed after ${options.maxAttempts} attempts`,
              error,
            );
            throw error;
          }

          // Calculate delay with jitter
          const jitter = delay * 0.1 * Math.random();
          const totalDelay = Math.min(delay + jitter, options.maxDelay);

          logger.warn(
            `${propertyKey} attempt ${attempt} failed, retrying in ${totalDelay}ms`,
          );

          await new Promise((resolve) => setTimeout(resolve, totalDelay));

          // Exponential backoff
          delay *= options.backoffFactor;
        }
      }

      throw lastError;
    };

    return descriptor;
  };
}

// Usage
@Injectable()
export class PartnerSyncService {
  @Retry({
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2,
    retryableErrors: [NetworkError, TimeoutError],
  })
  async syncBooking(booking: Booking): Promise<void> {
    // This method will be retried up to 5 times
    // with exponential backoff: 1s, 2s, 4s, 8s, 16s
    await this.partnerAPI.createBooking(booking);
  }
}
```

---

### Dead Letter Queue (DLQ)

```typescript
// pubsub-subscriber.service.ts
import { PubSub, Subscription } from '@google-cloud/pubsub';

@Injectable()
export class PubSubSubscriberService implements OnModuleInit {
  private pubsub: PubSub;

  async onModuleInit() {
    this.pubsub = new PubSub();
    await this.setupSubscriptions();
  }

  private async setupSubscriptions() {
    // Main subscription with DLQ
    const subscription = this.pubsub.subscription('booking-confirmed-sub', {
      deadLetterPolicy: {
        deadLetterTopic: this.pubsub.topic('booking-confirmed-dlq').name,
        maxDeliveryAttempts: 5,
      },
      retryPolicy: {
        minimumBackoff: { seconds: 10 },
        maximumBackoff: { seconds: 600 },
      },
    });

    subscription.on('message', async (message) => {
      try {
        const booking = JSON.parse(message.data.toString());
        await this.processBooking(booking);
        message.ack(); // Acknowledge successful processing
      } catch (error) {
        console.error('Failed to process booking:', error);
        message.nack(); // Negative acknowledge → retry
      }
    });

    // DLQ subscription (for manual intervention)
    const dlqSubscription = this.pubsub.subscription('booking-confirmed-dlq-sub');
    dlqSubscription.on('message', async (message) => {
      const booking = JSON.parse(message.data.toString());
      
      // Log to monitoring system
      await this.logger.error('Booking processing failed after max retries', {
        booking,
        attempts: message.deliveryAttempt,
      });

      // Send alert to operations team
      await this.alerting.sendAlert({
        severity: 'critical',
        title: 'Booking stuck in DLQ',
        description: `Booking ${booking.bookingId} failed after ${message.deliveryAttempt} attempts`,
      });

      message.ack(); // Remove from DLQ after logging
    });
  }
}
```

---

## Double-Booking Prevention

### Strategy 1: Distributed Locks (Redis)

```typescript
// inventory.service.ts
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import Redlock from 'redlock';

@Injectable()
export class InventoryService {
  private redlock: Redlock;

  constructor(private redis: Redis) {
    this.redlock = new Redlock([redis], {
      driftFactor: 0.01,
      retryCount: 3,
      retryDelay: 200,
      retryJitter: 200,
    });
  }

  async reserveUnit(
    propertyId: string,
    checkIn: Date,
    checkOut: Date,
  ): Promise<Reservation> {
    // Generate lock key
    const lockKey = `inventory:${propertyId}:${checkIn.toISOString()}:${checkOut.toISOString()}`;

    // Acquire lock (TTL: 30s)
    const lock = await this.redlock.acquire([lockKey], 30000);

    try {
      // 1. Check availability in database
      const available = await this.checkAvailability(propertyId, checkIn, checkOut);
      if (!available) {
        throw new ConflictException('Property not available');
      }

      // 2. Create soft reservation
      const reservation = await this.createReservation({
        propertyId,
        checkIn,
        checkOut,
        status: 'SOFT',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
      });

      return reservation;
    } finally {
      // Release lock
      await lock.release();
    }
  }

  private async checkAvailability(
    propertyId: string,
    checkIn: Date,
    checkOut: Date,
  ): Promise<boolean> {
    // Check for overlapping bookings
    const overlapping = await this.dataSource.query(
      `
      SELECT COUNT(*) as count
      FROM bookings
      WHERE property_id = $1
        AND status IN ('CONFIRMED', 'PENDING_PAYMENT')
        AND (
          (check_in < $3 AND check_out > $2)  -- Overlaps
        )
      `,
      [propertyId, checkIn, checkOut],
    );

    return overlapping[0].count === 0;
  }
}
```

---

### Strategy 2: Optimistic Locking (Database)

```sql
-- Add version column for optimistic locking
ALTER TABLE inventory ADD COLUMN version INT NOT NULL DEFAULT 1;

-- Update with version check
UPDATE inventory
SET 
  available_units = available_units - 1,
  version = version + 1
WHERE 
  property_id = $1
  AND check_in = $2
  AND check_out = $3
  AND available_units > 0
  AND version = $4  -- Optimistic lock check
RETURNING *;
```

```typescript
async function reserveWithOptimisticLock(
  propertyId: string,
  checkIn: Date,
  checkOut: Date,
): Promise<void> {
  let retries = 3;
  
  while (retries > 0) {
    // 1. Read current version
    const inventory = await this.inventoryRepo.findOne({
      where: { propertyId, checkIn, checkOut },
    });

    if (inventory.availableUnits <= 0) {
      throw new ConflictException('No units available');
    }

    // 2. Update with version check
    const result = await this.inventoryRepo.update(
      {
        propertyId,
        checkIn,
        checkOut,
        version: inventory.version, // Optimistic lock
      },
      {
        availableUnits: inventory.availableUnits - 1,
        version: inventory.version + 1,
      },
    );

    // 3. Check if update succeeded
    if (result.affected > 0) {
      return; // Success
    }

    // 4. Version mismatch → retry
    retries--;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new ConflictException('Failed to reserve unit after retries');
}
```

---

### Strategy 3: Database Constraints

```sql
-- Prevent overlapping bookings at database level
CREATE OR REPLACE FUNCTION check_booking_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM bookings
    WHERE property_id = NEW.property_id
      AND status IN ('CONFIRMED', 'PENDING_PAYMENT')
      AND id != NEW.id
      AND (
        (check_in < NEW.check_out AND check_out > NEW.check_in)
      )
  ) THEN
    RAISE EXCEPTION 'Booking overlaps with existing reservation';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_overlap_check
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_booking_overlap();
```

---

## Distributed Transaction Patterns

### Two-Phase Commit (2PC) - NOT RECOMMENDED

**Why we avoid 2PC:**
- **Blocking:** Coordinator failure blocks all participants
- **Performance:** Requires multiple round trips
- **Complexity:** Hard to implement correctly
- **Scalability:** Doesn't scale well

---

### Saga Pattern (RECOMMENDED)

**Advantages:**
- **Non-blocking:** Services don't wait for each other
- **Scalable:** Each service scales independently
- **Resilient:** Failures are handled via compensation
- **Flexible:** Easy to add new steps

**Trade-offs:**
- **Eventual consistency:** Data may be temporarily inconsistent
- **Complexity:** Requires careful design of compensating transactions
- **Debugging:** Harder to trace distributed flows

---

### Event Sourcing (Advanced)

```typescript
// Event store for full audit trail
interface BookingEvent {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: any;
  version: number;
  timestamp: Date;
}

// Rebuild state from events
function replayEvents(events: BookingEvent[]): Booking {
  let booking = new Booking();
  
  for (const event of events) {
    switch (event.eventType) {
      case 'BookingCreated':
        booking = { ...event.payload, status: 'PENDING' };
        break;
      case 'PaymentCompleted':
        booking.status = 'CONFIRMED';
        booking.paymentId = event.payload.paymentId;
        break;
      case 'BookingCancelled':
        booking.status = 'CANCELLED';
        break;
    }
  }
  
  return booking;
}
```

---

## Testing Transaction Integrity

### Unit Tests

```typescript
describe('BookingService', () => {
  it('should prevent double booking with distributed lock', async () => {
    const dto = { propertyId: '123', checkIn: '2025-01-01', checkOut: '2025-01-02' };

    // Simulate concurrent requests
    const [result1, result2] = await Promise.allSettled([
      service.createBooking(dto),
      service.createBooking(dto),
    ]);

    // One should succeed, one should fail
    expect(result1.status === 'fulfilled' || result2.status === 'fulfilled').toBe(true);
    expect(result1.status === 'rejected' || result2.status === 'rejected').toBe(true);
  });

  it('should rollback booking if payment fails', async () => {
    // Mock payment failure
    paymentService.createPayment.mockRejectedValue(new Error('Payment failed'));

    await expect(service.createBooking(dto)).rejects.toThrow();

    // Verify booking was rolled back
    const booking = await bookingRepo.findOne({ where: { id: dto.bookingId } });
    expect(booking.status).toBe('CANCELLED');
  });
});
```

### Integration Tests

```typescript
describe('Booking Saga (E2E)', () => {
  it('should complete full booking flow', async () => {
    // 1. Create booking
    const booking = await request(app)
      .post('/bookings')
      .send(bookingDto)
      .expect(201);

    // 2. Wait for inventory reservation
    await waitFor(() => 
      inventoryRepo.findOne({ where: { bookingId: booking.id, status: 'SOFT' } })
    );

    // 3. Complete payment
    await stripe.paymentIntents.confirm(booking.paymentIntentId);

    // 4. Wait for booking confirmation
    await waitFor(() =>
      bookingRepo.findOne({ where: { id: booking.id, status: 'CONFIRMED' } })
    );

    // 5. Verify inventory updated
    const inventory = await inventoryRepo.findOne({ where: { bookingId: booking.id } });
    expect(inventory.status).toBe('HARD');
  });
});
```

---

**Next:** [Operations, Security & Observability →](./03-operations-security.md)

