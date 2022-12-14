import { EnvKey } from '@libs/commons';
import { PlaywrightService } from '@libs/commons/playwright/playwright.service';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SlackService } from 'nestjs-slack';
import { ElementHandle, Page } from 'playwright';

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private logger = new Logger(AppService.name);
  private readonly maxRetry = 3;
  private readonly waitAfterConnectedInSec = 10;

  constructor(
    private readonly config: ConfigService,
    private readonly playwright: PlaywrightService,
    private readonly slackService: SlackService,
  ) {}

  async onApplicationBootstrap() {
    await this.testProxy();
    await this.handleCheckIsBlocked();
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
        this.logger.warn('wait for 1min to retry test');
        await new Promise((res) => setTimeout(res, 60000));
        retryCounter++;
      }
    } while (!passTest && retryCounter < 10);

    if (!passTest && retryCounter >= 10) {
      this.logger.debug('program killed because timout open test page');
      process.exit(1);
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCheckIsBlocked() {
    const page: Page = await this.playwright.createPage();
    const url =
      this.config.get<string>(EnvKey.LINK_TEST_BLOCKED) ||
      `https://www.kaskus.co.id/forum`;
    const xpath = 'xpath=//head/title';
    const contentPattern = './text()';
    let passTest = false;
    let retryCounter = 0;

    this.logger.log(`test open ${url}`);
    do {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout,
        });

        this.logger.debug(
          `wait for ${
            this.waitAfterConnectedInSec
          }s after success load ${page.url()}`,
        );
        await new Promise((res) =>
          setTimeout(res, this.waitAfterConnectedInSec * 1000),
        );

        const containers = await page.$$(xpath);

        if (containers.length > 0) {
          this.logger.debug(
            `Found ${containers.length} containers, scraping can start`,
          );

          for (const container of containers) {
            const data = await this.getXpathContent(
              container,
              contentPattern,
              'text',
            );
            data.forEach((d) => console.log(d));
            if (page && !page.isClosed()) {
              await page.close();
              this.logger.log('Test completed!, page closed');
              passTest = true;
            }
          }
        } else {
          this.sendMessageSlack(`Container not found. Trying to ensure... `);
        }
      } catch (error) {
        this.sendMessageSlack(error.message);
        this.logger.error(
          `fail start module browser because : ${error.message}`,
        );
      }

      //if test not pass then wait 5s to try again and update counter
      if (!passTest) {
        this.logger.warn('wait for 1min to retry test');
        await new Promise((res) => setTimeout(res, 1000));
        retryCounter++;
      } else {
        if (page && !page.isClosed()) {
          await page.close();
          this.logger.debug('Test not blocked success');
        }
      }
    } while (!passTest && retryCounter < 10);

    if (!passTest && retryCounter >= 10) {
      this.logger.debug('program killed because timout open test page');
      process.exit(1);
    }
  }

  private async getXpathContent(
    containerContext: ElementHandle<SVGElement | HTMLElement>,
    pattern: string,
    returnType: 'text' | 'html',
  ) {
    if (!containerContext) {
      return [];
    }

    const evaluateParam: [string, 'text' | 'html'] = [pattern, returnType];
    const data = await containerContext.evaluate(
      (context, [pattern, returnType]) => {
        const getContent = (el: Node | Element) =>
          returnType === 'text' ? el.nodeValue : (el as Element).innerHTML;
        const vals = document.evaluate(
          pattern as string,
          context,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null,
        );
        const result = [];
        if (vals.snapshotLength > 0) {
          for (let i = 0; i < vals.snapshotLength; i++) {
            result.push(vals.snapshotItem(i));
          }
        }
        return result.map(getContent);
      },
      evaluateParam,
    );
    return data;
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
