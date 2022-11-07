import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  appendFileSync,
  existsSync,
  readFile,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import * as moment from 'moment';
import {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  firefox,
  LaunchOptions,
  Page,
} from 'playwright';
import { catchError, defer, firstValueFrom, of, retry, tap, timer } from 'rxjs';
import IORedis from 'ioredis';
import { Cron, CronExpression } from '@nestjs/schedule';
import { md5 } from '@libs/commons/helper/md5';

type CreateContextOptions = {
  launchOptions?: LaunchOptions;
  context?: BrowserContextOptions;
  cookiesPath?: string;
};

@Injectable()
export class PlaywrightService implements OnApplicationBootstrap, OnModuleInit {
  private readonly logger = new Logger(PlaywrightService.name);
  private browserContext: BrowserContext;
  private browserState = 'closed';
  private cacheToFile = false;
  keyLastCookiesSave = 'pls:last-cookies-save';
  keyLockUpdateCookies = 'pls:on-update-cookies';

  constructor(
    private readonly config: ConfigService,
    @Inject('redis') private readonly redis: IORedis,
  ) {}

  async onModuleInit() {
    this.logger.debug('launching firefox');
    await this.initBrowser(false, this.cookiesPath);
    this.logger.debug('firefox ready');
  }

  async onApplicationBootstrap() {
    let passTest = false;
    let retryCounter = 0;
    do {
      //try to test browser
      try {
        await this.testBrowser();
        passTest = true;
      } catch (error) {
        //fail log error
        this.logger.error(
          `fail start module browser because : ${error.message}`,
        );
      }

      //if test not pass then wait 5s to try again and update counter
      if (!passTest) {
        this.logger.warn('wait for 5s to retry test');
        await new Promise((res) => setTimeout(res, 5000));
        retryCounter++;
      }
    } while (!passTest && retryCounter < 10);

    if (!passTest && retryCounter >= 10) {
      this.logger.debug('program killed because timout open test page');
      process.exit(1);
    }
  }

  private async initBrowser(test = false, cookiesPath?: string) {
    if (this.browserState !== 'closed') {
      await new Promise((res) => setTimeout(res, 1000 * 10));
      return;
    }

    this.browserState = 'creating';
    const launchOptions: LaunchOptions = {
      headless: this.config.get<string>('HEADLESS', 'true') === 'true',
    };
    const proxyServer = this.config.get('PROXY_SERVER');
    const proxyUser = this.config.get('PROXY_USER');
    const proxyPass = this.config.get('PROXY_PASS');

    if (proxyServer) {
      this.logger.debug('use proxy ' + proxyServer);
      launchOptions.proxy = { server: proxyServer };
    }

    if (proxyServer && proxyPass && proxyUser) {
      launchOptions.proxy.password = proxyPass;
      launchOptions.proxy.username = proxyUser;
      this.logger.debug('setup proxy auth');
    }

    await this.createBrowserContext({
      launchOptions,
      cookiesPath,
    });

    if (test && this.browserState === 'created') {
      try {
        await this.testBrowser();
      } catch (error) {
        //do noting
      }
    }
  }

  private async createBrowserContext({
    launchOptions,
    context,
    cookiesPath,
  }: CreateContextOptions) {
    this.logger.log('create browser context');
    const createBrowser$ = defer(() => firefox.launch(launchOptions)).pipe(
      retry({
        count: 3,
        delay: (_, retryCount) => (retryCount === 1 ? timer(5000) : of({})),
      }),
      catchError((e) => {
        this.logger.error(e.message, `fail create browser instance`);
        return of(null);
      }),
    );

    const browser: Browser = await firstValueFrom(createBrowser$);
    if (browser === null || browser === undefined) {
      process.exit(1);
    }

    this.browserContext = await browser.newContext(context);
    this.logger.log('context browser created');

    if (existsSync(cookiesPath)) {
      this.logger.debug('try to load cookies');
      const cookies =
        JSON.parse(readFileSync(cookiesPath).toString()) ?? undefined;
      if (Array.isArray(cookies)) {
        this.browserContext.addCookies(cookies);
        this.logger.debug('cookies loaded');
      }
    }

    this.browserState = 'created';
    await this.saveCookiesIncremental();

    this.browserContext.once('close', () => {
      this.browserState = 'closed';
      this.browserContext = null;
    });
  }

  private async testBrowser() {
    const prevSet = this.cacheToFile;

    if (prevSet) {
      this.cacheToFile = !prevSet;
    }

    const page = await this.createPage();
    try {
      this.logger.debug('test open browser');
      const res = await page.goto('https://checker.soax.com/api/ipinfo', {
        timeout: 30000,
      });
      const { data } = await res.json();
      const { ip: ipBrowser, isp } = data;
      const proxyServer = this.config.get('PROXY_SERVER');
      const isUseProxy =
        proxyServer !== null ? 'with ip proxy ' + proxyServer : null;
      this.logger.debug(
        `this broser ip is ${ipBrowser} (${isp}) ${isUseProxy} `,
      );
      this.logger.debug('browser is ready');

      await page?.close();
      this.cacheToFile = prevSet;
    } catch (error) {
      await page?.close();
      throw error;
    }
  }

  async createPage(): Promise<Page> {
    if (this.browserState === 'created') {
      if (!this.browserContext) {
        this.browserState = 'closed';
        return this.createPage();
      }

      let page: Page;
      try {
        page = await this.browserContext.newPage();
      } catch (error) {
        if (error.message?.includes('context or browser has been closed')) {
          process.exit(1);
        }
        throw error;
      }

      if (!page) {
        throw new Error('page not created');
      }

      const inMinutes = 60;
      if (this.cacheToFile) {
        this.hookCacheFile(page);
      }
      // page.on('console', console.log);
      this.hookTimeoutPage(page, inMinutes);
      return page;
    } else {
      await this.initBrowser(true);
      return this.createPage();
    }
    // throw new Error("Cant create new page, coz browser context already closed");
  }

  private hookCacheFile(page: Page) {
    appendFileSync('outs/cache.log', '\n\n--- new session --\n\n');

    page.route(
      () => true,
      (route, req) => {
        const resourceType = req.resourceType();
        const url = req.url();

        // image
        if (['image', 'media'].includes(resourceType)) {
          const hashURL = md5(url);
          const path = './browserCache/' + hashURL;
          const metaPath = path + '.meta';

          if (existsSync(path) && existsSync(metaPath)) {
            const { headers, status } = JSON.parse(
              readFileSync(metaPath).toString(),
            );

            readFile(path, (err, body) => {
              if (err) {
                if (page && !page.isClosed()) {
                  route.continue();
                }
              } else {
                if (page && !page.isClosed()) {
                  route.fulfill({ body, headers, status });
                }
              }
            });
          } else {
            //continue
            if (page && !page.isClosed()) {
              route.continue();
            }
          }
        } else {
          if (page && !page.isClosed()) {
            route.continue();
          }
        }
      },
    );

    page.on('response', (res) => {
      const req = res.request();

      if (
        ['image', 'media'].includes(req.resourceType()) &&
        res.status() < 300
      ) {
        const hashURL = md5(req.url());
        const pathBuffer = './browserCache/' + hashURL;
        const metaPath = pathBuffer + '.meta';

        const createMetaFile = () => {
          if (typeof res.allHeaders === 'function') {
            res?.allHeaders().then((headers) => {
              writeFileSync(
                metaPath,
                JSON.stringify({
                  headers,
                  status: res?.status(),
                }),
              );
            });
          }
        };

        const createBufferFile = () => {
          if (typeof res.body === 'function') {
            res?.body().then((buff) => writeFileSync(pathBuffer, buff));
          }
        };

        const createFile = (path: string, cbCreateFile: () => void) => {
          if (!existsSync(path)) {
            cbCreateFile();
          } else {
            const stat = statSync(path);
            const ageFile = moment(stat.birthtime).diff(moment(), 'h');
            if (ageFile > 3) {
              cbCreateFile();
            }
          }
        };

        createFile(metaPath, createMetaFile);
        createFile(pathBuffer, createBufferFile);
      }
    });
  }

  private hookTimeoutPage(page: Page, inMinutes: number) {
    setTimeout(() => {
      if (!page.isClosed()) {
        page
          .close()
          .catch(() => {
            this.logger.error(`can't close page properly ${page.url()}`);
          })
          .then(() => {
            this.logger.error(
              `close page ${page.url()} because page age more than ${inMinutes} minutes`,
            );
          });
      }
    }, 1000 * 60 * inMinutes);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async saveCookiesIncremental() {
    const cookiePath = this.cookiesPath;
    console.log({ cookiePath });

    if (!cookiePath) {
      return;
    }

    const waitTime = Math.random() * 999;
    this.logger.debug({ waitTime });
    //make random delay to prevent check lockfile same time
    await new Promise((res) => setTimeout(res, waitTime));

    const isUpdateByOther = existsSync('outs/.lockcookies');
    this.logger.debug({ isUpdateByOther });

    if (isUpdateByOther) {
      this.logger.debug('update cookies by other apps');
      return;
    }

    writeFileSync('outs/.lockcookies', 'lockfile');
    this.logger.debug('update cookies');

    const now = moment();
    const unitTime = 'h';
    const lastCookiesSave = await this.redis.get(this.keyLastCookiesSave);
    const mLastCookiesSave = lastCookiesSave
      ? moment(lastCookiesSave)
      : moment().subtract(10, unitTime);
    const diffTime = mLastCookiesSave.diff(now, unitTime);
    this.logger.debug({ diffTime });

    if (diffTime < -5) {
      this.logger.debug('try upadate cookies');

      const cookies = await this.browserContext.cookies();
      writeFileSync(this.cookiesPath, JSON.stringify(cookies));
      await this.redis.set(this.keyLastCookiesSave, now.toISOString());

      this.logger.debug('cookies updated');
    } else {
      this.logger.debug(`cookies last updated at ${mLastCookiesSave}`);
    }

    this.logger.debug('release lock update cookies');
    unlinkSync('outs/.lockcookies');
  }

  private get cookiesPath(): string {
    return this.config.get<string>('COOKIES_PATH');
  }
}
