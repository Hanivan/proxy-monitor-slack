import { EnvKey } from '@libs/commons';
import { PlaywrightService } from '@libs/commons/playwright/playwright.service';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SlackService } from 'nestjs-slack';

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private logger = new Logger(AppService.name);
  private readonly maxRetry = 3;

  constructor(
    private readonly config: ConfigService,
    private readonly playwright: PlaywrightService,
    private readonly slackService: SlackService,
  ) {}

  async onApplicationBootstrap() {
    await this.testProxy();
  }

  get timeout() {
    return Number(this.config.get<string>('BROWSER_TIMEOUT', '30000'));
  }

  @Cron(CronExpression.EVERY_3_HOURS)
  async testProxy() {
    let passTest = false;
    let retryCounter = 0;

    do {
      //try to test browser
      try {
        await this.playwright.testBrowser();
        passTest = true;
      } catch (error) {
        //every fail, send to slack & log error
        this.sendMessageSlack(error.message);

        this.logger.error(
          `fail start module browser because : ${error.message}`,
        );
      }

      //if test not pass then wait 5s to try again and update counter
      if (!passTest) {
        this.logger.warn('wait for 10s to retry test');
        await new Promise((res) => setTimeout(res, 10000));
        retryCounter++;
      }
    } while (!passTest && retryCounter < 10);

    if (!passTest && retryCounter >= 10) {
      this.logger.debug('program killed because timout open test page');
      process.exit(1);
    }
  }

  sendMessageSlack(errMessage: string): string {
    const msg =
      'Proxy with ip `' +
      `${this.proxyIP}` +
      '` has error with code\n\n' +
      '```' +
      errMessage +
      '```';

    this.slackService.sendText(msg, { mrkdwn: true });

    return msg;
  }

  get proxyIP() {
    const LEN_NETWORK_IP = 2;
    let hiddenIP = ['*'];
    const arrNet = this.config.get<string>(EnvKey.PROXY_SERVER);
    const cleanIP = arrNet.replace(/^https?:\/\//, '');
    const IP = cleanIP.split(':')[0];
    const port = cleanIP.split(':')[1];
    const arrIP = IP.split('.');

    for (let i = 0; i < LEN_NETWORK_IP; i++) {
      arrIP[i] = '*';
      hiddenIP.push(arrIP[i]);
    }
    hiddenIP.push(arrIP.at(-1));

    return `${hiddenIP.join('.')}:${port}`;
  }

  getHello(): string {
    return 'Hello World!';
  }
}
