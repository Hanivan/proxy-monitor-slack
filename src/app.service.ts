import { PlaywrightService } from '@libs/commons/playwright/playwright.service';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SlackService } from 'nestjs-slack';
import { ElementHandle, Page } from 'playwright';

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private logger = new Logger(AppService.name);
  private waitAfterConnectedInSec = 5;
  private readonly maxRetry = 3;

  constructor(
    private readonly config: ConfigService,
    private readonly playwright: PlaywrightService,
    private readonly slackService: SlackService,
  ) {}

  async onApplicationBootstrap() {
    // const url = 'https://hanivan.my.id';
    // const containerPattern = 'xpath=//section';
    // const contentPattern =
    //   './p[@class="hidden lg:block"]/text()[normalize-space()]';
    // const page: Page = await this.playwright.createPage();
    // this.logger.log(`Start scrape from ${url}`);
    // try {
    //   await page.goto(url, {
    //     waitUntil: 'domcontentloaded',
    //     timeout: this.timeout,
    //   });
    //   this.logger.debug(
    //     `wait for ${
    //       this.waitAfterConnectedInSec
    //     }s after success load ${page.url()}`,
    //   );
    //   await new Promise((res) =>
    //     setTimeout(res, this.waitAfterConnectedInSec * 1000),
    //   );
    //   await this.challangeCloudflareByWaiting(page);
    //   const res = await this.waitForResponse(page, 'github');
    //   if (res) {
    //     const containers = await page.$$(containerPattern);
    //     if (containers.length > 0) {
    //       this.logger.debug(
    //         `Found ${containers.length} containers, scraping can start`,
    //       );
    //       for (const container of containers) {
    //         const data = await this.getXpathContent(
    //           container,
    //           contentPattern,
    //           'text',
    //         );
    //         data.forEach((d) => console.log(d));
    //         if (page && !page.isClosed()) {
    //           await page.close();
    //           this.logger.log('Scrape done, page closed');
    //         }
    //       }
    //     }
    //   } else {
    //     if (page && !page.isClosed()) {
    //       await page.close();
    //       this.logger.error('Container not found');
    //     }
    //   }
    // } catch (error) {
    //   if (page && !page.isClosed()) {
    //     await page.close();
    //     this.logger.error('Something went wrong, verbose close page');
    //   }
    //   throw error;
    // }
  }

  private async waitForResponse(page: Page, url: string) {
    this.logger.debug(`Waiting for response from ${url}`);

    await page
      .waitForRequest((response) => response.url().includes(url), {
        timeout: 3000,
      })
      .catch((err) => {
        this.logger.log(`All request from ${url} done`);
      });

    return page.on('request', async (req) => {
      if (req.url().includes(url)) {
        return await Promise.all([
          page.waitForResponse(
            (res) => res.url().includes(url) && res.status() === 200,
          ),
        ]).catch((err) => {});
      }
    });
  }

  private async getRequest(page: Page) {
    page.on('request', (request) =>
      console.log('>>', request.method(), request.url()),
    );
    page.on('response', (response) =>
      console.log('<<', response.status(), response.url()),
    );
  }

  private async challangeCloudflareByWaiting(page: Page) {
    let pageTitle: string;
    const cloudflareTitle = 'Just a moment...';
    const waitCloudflare = 10;
    let isCloudflare = false;
    let iteration = 0;

    try {
      do {
        pageTitle = await page.title();
        ++iteration;

        if (iteration > this.maxRetry) {
          return null;
        }

        if (pageTitle !== cloudflareTitle) {
          this.logger.log('Cloudflare challenge passed');
          return !isCloudflare;
        }

        this.logger.debug(
          `Waiting for cloudflare challenge... [${iteration}/${this.maxRetry}] by ${waitCloudflare}s`,
        );
        await new Promise((res) => setTimeout(res, waitCloudflare * 1000));
      } while (pageTitle === cloudflareTitle);
    } catch (error) {
      throw error;
    }
    return false;
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

  get timeout() {
    return Number(this.config.get<string>('BROWSER_TIMEOUT', '30000'));
  }

  testSlackHello(): string {
    const msg = 'jkqnwjkeqwe\nlaslmasd ```Hello```';
    this.slackService.sendText(msg, { mrkdwn: true });
    return 'Hello World';
  }

  sendMessageToSlack(message: string) {}

  getHello(): string {
    return 'Hello World!';
  }
}
