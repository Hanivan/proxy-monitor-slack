import { EnvKey } from '@libs/commons';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const configModule = await NestFactory.createApplicationContext(ConfigModule);
  const configService = configModule.get(ConfigService);
  const port = configService.get<number>(EnvKey.APP_PORT, 3000);
  const app = await NestFactory.create(AppModule);

  await app.listen(port);
}
bootstrap();
