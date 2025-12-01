import { Module, Global } from '@nestjs/common';
import { RedisService } from './services/redis.service';
import { PubSubService } from './services/pubsub.service';
import { CloudTasksService } from './services/cloud-tasks.service';
import { LoggerService } from './services/logger.service';
import { MetricsService } from './services/metrics.service';
import { SecretsService } from './services/secrets.service';

@Global()
@Module({
  providers: [
    RedisService,
    PubSubService,
    CloudTasksService,
    LoggerService,
    MetricsService,
    SecretsService,
  ],
  exports: [
    RedisService,
    PubSubService,
    CloudTasksService,
    LoggerService,
    MetricsService,
    SecretsService,
  ],
})
export class SharedModule {}

