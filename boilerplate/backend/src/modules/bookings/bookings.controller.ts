import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { AuthGuard } from '../../shared/guards/auth.guard';
import { RateLimitGuard } from '../../shared/guards/rate-limit.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('bookings')
@Controller('bookings')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiBearerAuth()
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new booking' })
  @ApiResponse({
    status: 201,
    description: 'Booking created successfully',
    type: BookingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 409, description: 'Property not available (double booking)' })
  async createBooking(
    @Body() createBookingDto: CreateBookingDto,
    @CurrentUser() user: User,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.createBooking(createBookingDto, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking by ID' })
  @ApiResponse({
    status: 200,
    description: 'Booking found',
    type: BookingResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  async getBooking(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.getBooking(id, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all bookings for current user' })
  @ApiResponse({
    status: 200,
    description: 'List of bookings',
    type: [BookingResponseDto],
  })
  async getBookings(@CurrentUser() user: User): Promise<BookingResponseDto[]> {
    return this.bookingsService.getBookingsByUser(user.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a booking' })
  @ApiResponse({ status: 200, description: 'Booking cancelled successfully' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiResponse({ status: 409, description: 'Booking cannot be cancelled' })
  async cancelBooking(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.cancelBooking(id, user.id);
  }
}

