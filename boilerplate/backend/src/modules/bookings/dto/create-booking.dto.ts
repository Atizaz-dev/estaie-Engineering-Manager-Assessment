import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsDateString, IsInt, Min, Max, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({
    description: 'Property ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  propertyId: string;

  @ApiProperty({
    description: 'Check-in date (ISO 8601)',
    example: '2025-12-15',
  })
  @IsDateString()
  checkIn: string;

  @ApiProperty({
    description: 'Check-out date (ISO 8601)',
    example: '2025-12-20',
  })
  @IsDateString()
  checkOut: string;

  @ApiProperty({
    description: 'Number of guests',
    example: 2,
    minimum: 1,
    maximum: 20,
  })
  @IsInt()
  @Min(1)
  @Max(20)
  guests: number;

  @ApiProperty({
    description: 'Total booking amount',
    example: 500.00,
  })
  @IsNumber()
  @Min(0)
  totalAmount: number;

  @ApiProperty({
    description: 'Currency code (ISO 4217)',
    example: 'USD',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiProperty({
    description: 'Special requests or notes',
    example: 'Late check-in required',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  specialRequests?: string;
}

