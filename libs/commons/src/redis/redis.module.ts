import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

const redisProvider = {
  provide: 'redis',
  useFactory(config: ConfigService) {
    return new IORedis({
      host: config.get('REDIS_HOST', 'localhost'),
      port: Number(config.get('REDIS_PORT', 6379)),
      db: Number(config.get('REDIS_DB', 0)),
    });
  },
  inject: [ConfigService],
};

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.env', '.env.prod', '.env.dev', 'env.example'],
    }),
  ],
  providers: [redisProvider],
  exports: [redisProvider],
})
export class RedisModule {}
