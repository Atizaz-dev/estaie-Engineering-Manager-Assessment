import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { OutboxProcessorService } from './services/outbox-processor.service';
import { SharedModule } from '../../shared/shared.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, OutboxEvent]),
    SharedModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService, OutboxProcessorService],
  exports: [BookingsService],
})
export class BookingsModule {}

