import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '../entities/booking.entity';

export class BookingResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001' })
  userId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174002' })
  propertyId: string;

  @ApiProperty({ example: '2025-12-15' })
  checkIn: string;

  @ApiProperty({ example: '2025-12-20' })
  checkOut: string;

  @ApiProperty({ example: 2 })
  guests: number;

  @ApiProperty({ example: 500.00 })
  totalAmount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  status: BookingStatus;

  @ApiProperty({ example: 'pi_1234567890', nullable: true })
  paymentId: string | null;

  @ApiProperty({ example: 'Late check-in required', nullable: true })
  specialRequests: string | null;

  @ApiProperty({ example: '2025-12-01T10:00:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2025-12-01T10:05:00Z', nullable: true })
  confirmedAt: string | null;

  @ApiProperty({ example: null, nullable: true })
  cancelledAt: string | null;
}

