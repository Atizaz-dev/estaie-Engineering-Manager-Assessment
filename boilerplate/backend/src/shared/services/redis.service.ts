import { Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import Redlock from 'redlock';

export interface Lock {
  key: string;
  value: string;
}

@Injectable()
export class RedisService implements OnModuleInit {
  private redis: Redis;
  private redlock: Redlock;

  onModuleInit() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redlock = new Redlock([this.redis], {
      driftFactor: 0.01,
      retryCount: 3,
      retryDelay: 200,
      retryJitter: 200,
    });
  }

  async acquireLock(key: string, ttl: number): Promise<Lock> {
    const lockValue = crypto.randomUUID();
    const acquired = await this.redis.set(key, lockValue, 'PX', ttl, 'NX');

    if (!acquired) {
      throw new Error(`Failed to acquire lock: ${key}`);
    }

    return { key, value: lockValue };
  }

  async releaseLock(lock: Lock): Promise<void> {
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

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  getClient(): Redis {
    return this.redis;
  }
}

