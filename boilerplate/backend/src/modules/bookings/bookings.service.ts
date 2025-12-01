import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { RedisService } from '../../shared/services/redis.service';
import { PubSubService } from '../../shared/services/pubsub.service';
import { CloudTasksService } from '../../shared/services/cloud-tasks.service';
import { LoggerService } from '../../shared/services/logger.service';
import { MetricsService } from '../../shared/services/metrics.service';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private bookingRepo: Repository<Booking>,
    @InjectRepository(OutboxEvent)
    private outboxRepo: Repository<OutboxEvent>,
    private dataSource: DataSource,
    private redisService: RedisService,
    private pubsubService: PubSubService,
    private cloudTasksService: CloudTasksService,
    private logger: LoggerService,
    private metrics: MetricsService,
  ) {}

  async createBooking(
    dto: CreateBookingDto,
    userId: string,
  ): Promise<BookingResponseDto> {
    const startTime = Date.now();
    const lockKey = `booking:${dto.propertyId}:${dto.checkIn}:${dto.checkOut}`;

    this.logger.log('Creating booking', 'BookingsService', {
      userId,
      propertyId: dto.propertyId,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
    });

    // Acquire distributed lock (30s TTL)
    const lock = await this.redisService.acquireLock(lockKey, 30000);

    try {
      // Start database transaction
      return await this.dataSource.transaction(async (manager) => {
        // 1. Check availability (prevent double-booking)
        const overlapping = await manager
          .createQueryBuilder(Booking, 'booking')
          .where('booking.propertyId = :propertyId', {
            propertyId: dto.propertyId,
          })
          .andWhere('booking.status IN (:...statuses)', {
            statuses: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
          })
          .andWhere(
            '(booking.checkIn < :checkOut AND booking.checkOut > :checkIn)',
            {
              checkIn: dto.checkIn,
              checkOut: dto.checkOut,
            },
          )
          .getCount();

        if (overlapping > 0) {
          throw new ConflictException('Property not available for selected dates');
        }

        // 2. Create booking record
        const booking = manager.create(Booking, {
          userId,
          propertyId: dto.propertyId,
          checkIn: new Date(dto.checkIn),
          checkOut: new Date(dto.checkOut),
          guests: dto.guests,
          totalAmount: dto.totalAmount,
          currency: dto.currency || 'USD',
          status: BookingStatus.PENDING_PAYMENT,
          specialRequests: dto.specialRequests,
        });
        await manager.save(booking);

        // 3. Create outbox event (for guaranteed delivery)
        const outboxEvent = manager.create(OutboxEvent, {
          aggregateId: booking.id,
          aggregateType: 'Booking',
          eventType: 'booking.created',
          payload: {
            bookingId: booking.id,
            userId: booking.userId,
            propertyId: booking.propertyId,
            checkIn: booking.checkIn.toISOString(),
            checkOut: booking.checkOut.toISOString(),
            totalAmount: booking.totalAmount,
            currency: booking.currency,
          },
          status: 'PENDING',
        });
        await manager.save(outboxEvent);

        // 4. Publish event (async, best-effort)
        await this.pubsubService.publish('booking.created', outboxEvent.payload);

        // 5. Schedule timeout task (15 min)
        await this.cloudTasksService.scheduleTask({
          url: `${process.env.API_URL}/bookings/${booking.id}/timeout`,
          payload: { bookingId: booking.id },
          scheduleTime: Date.now() + 15 * 60 * 1000, // 15 minutes
        });

        // Record metrics
        const duration = Date.now() - startTime;
        this.metrics.recordBookingCreated('extended-stay', 'UAE');
        this.logger.log('Booking created successfully', 'BookingsService', {
          bookingId: booking.id,
          duration,
        });

        return this.toResponseDto(booking);
      });
    } catch (error) {
      this.logger.error(
        'Failed to create booking',
        error.stack,
        'BookingsService',
        {
          userId,
          propertyId: dto.propertyId,
          error: error.message,
        },
      );
      throw error;
    } finally {
      // Release lock
      await this.redisService.releaseLock(lock);
    }
  }

  async getBooking(id: string, userId: string): Promise<BookingResponseDto> {
    const booking = await this.bookingRepo.findOne({
      where: { id },
      relations: ['property', 'user'],
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Check authorization
    if (booking.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return this.toResponseDto(booking);
  }

  async getBookingsByUser(userId: string): Promise<BookingResponseDto[]> {
    const bookings = await this.bookingRepo.find({
      where: { userId },
      relations: ['property'],
      order: { createdAt: 'DESC' },
    });

    return bookings.map((booking) => this.toResponseDto(booking));
  }

  async confirmBooking(bookingId: string, paymentId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // 1. Update booking status
      const booking = await manager.findOne(Booking, { where: { id: bookingId } });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

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
          confirmedAt: booking.confirmedAt.toISOString(),
        },
        status: 'PENDING',
      });
      await manager.save(outboxEvent);

      // 3. Publish event
      await this.pubsubService.publish('booking.confirmed', outboxEvent.payload);

      this.logger.log('Booking confirmed', 'BookingsService', {
        bookingId: booking.id,
        paymentId,
      });
    });
  }

  async cancelBooking(id: string, userId: string): Promise<BookingResponseDto> {
    return await this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, { where: { id } });

      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (booking.userId !== userId) {
        throw new ForbiddenException('Access denied');
      }

      if (
        booking.status !== BookingStatus.PENDING_PAYMENT &&
        booking.status !== BookingStatus.CONFIRMED
      ) {
        throw new ConflictException('Booking cannot be cancelled');
      }

      booking.status = BookingStatus.CANCELLED;
      booking.cancelledAt = new Date();
      await manager.save(booking);

      // Create outbox event
      const outboxEvent = manager.create(OutboxEvent, {
        aggregateId: booking.id,
        aggregateType: 'Booking',
        eventType: 'booking.cancelled',
        payload: {
          bookingId: booking.id,
          userId: booking.userId,
          cancelledAt: booking.cancelledAt.toISOString(),
        },
        status: 'PENDING',
      });
      await manager.save(outboxEvent);

      // Publish event
      await this.pubsubService.publish('booking.cancelled', outboxEvent.payload);

      this.logger.log('Booking cancelled', 'BookingsService', {
        bookingId: booking.id,
      });

      return this.toResponseDto(booking);
    });
  }

  private toResponseDto(booking: Booking): BookingResponseDto {
    return {
      id: booking.id,
      userId: booking.userId,
      propertyId: booking.propertyId,
      checkIn: booking.checkIn.toISOString(),
      checkOut: booking.checkOut.toISOString(),
      guests: booking.guests,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      status: booking.status,
      paymentId: booking.paymentId,
      specialRequests: booking.specialRequests,
      createdAt: booking.createdAt.toISOString(),
      confirmedAt: booking.confirmedAt?.toISOString(),
      cancelledAt: booking.cancelledAt?.toISOString(),
    };
  }
}

