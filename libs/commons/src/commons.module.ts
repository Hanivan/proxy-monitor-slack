import { Module } from '@nestjs/common';
import { CommonsService } from './commons.service';
import { PlaywrightModule } from './playwright/playwright.module';
import { RedisModule } from './redis/redis.module';

@Module({
  providers: [CommonsService],
  exports: [CommonsService],
  imports: [PlaywrightModule, RedisModule],
})
export class CommonsModule {}
