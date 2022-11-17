import { Module } from '@nestjs/common';
import { RedisModule } from '@libs/commons/redis/redis.module';
import { PlaywrightService } from './playwright.service';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    RedisModule,
    ConfigModule.forRoot({
      envFilePath: ['.env', '.env.prod', '.env.dev', 'env.example'],
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [PlaywrightService],
  exports: [PlaywrightService],
})
export class PlaywrightModule {}
