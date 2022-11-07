import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PlaywrightModule } from '@libs/commons/playwright/playwright.module';
import { SlackModule } from 'nestjs-slack';
import { EnvKey } from '@libs/commons';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.env', '.env.prod', '.env.dev', 'env.example'],
    }),
    PlaywrightModule,
    SlackModule.forRootAsync({
      imports: [
        ConfigModule.forRoot({
          envFilePath: ['.env', '.env.prod', '.env.dev', 'env.example'],
        }),
      ],
      useFactory: async (config: ConfigService) => {
        const urlWebhook = config.get<string>(EnvKey.WEBHOOK_URL, undefined);

        if (!urlWebhook) {
          Logger.error('urlWebhook is undefined');
        }

        return {
          type: 'webhook',
          url: urlWebhook,
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
