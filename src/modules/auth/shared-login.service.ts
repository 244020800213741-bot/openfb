import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { firefox, Browser, Page } from 'playwright';

/**
 * Manages a shared Facebook login session.
 *
 * Opens a visible Camoufox browser pointed at facebook.com using a dedicated
 * profile directory (`./data/profiles/_shared_login`). The user logs in
 * manually once; the cookies persist on disk. New sessions copy this profile
 * to inherit the login without re-entering credentials.
 *
 * This is the "Login FB" button on the dashboard.
 */
@Injectable()
export class SharedLoginService {
  private readonly logger = new Logger(SharedLoginService.name);
  private readonly sharedProfileDir: string;
  private process: ChildProcess | null = null;
  private wsEndpoint: string | null = null;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private loginWindowActive = false;

  constructor(private readonly config: ConfigService) {
    const baseDir = this.config.get<string>('CAMOUFOX_USER_DATA_DIR') || './data/profiles';
    this.sharedProfileDir = `${baseDir}/_shared_login`;
  }

  get profileDir(): string {
    return this.sharedProfileDir;
  }

  /**
   * Whether the shared login profile exists on disk.
   * Used by the factory to decide whether to copy it into new sessions.
   */
  get hasSharedProfile(): boolean {
    // We check for a marker file instead of just the dir, because the dir
    // may exist but be empty if login was never completed.
    try {
      return fs.existsSync(path.join(this.sharedProfileDir, '.openfb_logged_in'));
    } catch {
      return false;
    }
  }

  /**
   * Open a browser window for the user to log in to Facebook.
   * The window stays open until the user closes it or calls closeLoginWindow().
   */
  async openLoginWindow(): Promise<{ wsEndpoint: string; message: string }> {
    if (this.loginWindowActive && this.wsEndpoint) {
      return {
        wsEndpoint: this.wsEndpoint,
        message: 'Login window already open. Complete the login in the browser.',
      };
    }

    this.logger.log('Starting shared login window...');

    // 1. Start a Camoufox process with the shared profile, visible (headless=false)
    const port = await this.findFreePort();
    const launcherScript = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'scripts',
      'camoufox-launcher',
      'launch_server.py',
    );

    const args = [
      launcherScript,
      '--headless', 'false',
      '--user-data-dir', this.sharedProfileDir,
      '--port', String(port),
      '--ws-path', 'openfb-shared-login',
    ];

    this.process = spawn('python', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.wsEndpoint = await new Promise<string>((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          reject(new Error('Camoufox login window did not start within 60 seconds'));
          this.killProcess();
        }
      }, 60_000);

      this.process!.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        process.stdout.write(`[camoufox-login] ${text}`);
        const match = text.match(/(ws:\/\/[^\s]+)/);
        if (match && !resolved) {
          this.wsEndpoint = match[1];
          resolved = true;
          clearTimeout(timeout);
          resolve(this.wsEndpoint);
        }
      });

      this.process!.stderr?.on('data', (data: Buffer) => {
        process.stderr.write(`[camoufox-login:err] ${data.toString()}`);
      });

      this.process!.on('exit', (code) => {
        clearTimeout(timeout);
        this.process = null;
        this.wsEndpoint = null;
        this.loginWindowActive = false;
        if (!resolved && code !== 0) {
          reject(new Error(`Camoufox login process exited with code ${code}`));
        }
      });
    });

    // 2. Connect via Playwright and navigate to Facebook
    this.browser = await firefox.connect(this.wsEndpoint, { timeout: 30_000 });
    const contexts = this.browser.contexts();
    const ctx = contexts[0] ?? (await this.browser.newContext());
    const pages = ctx.pages();
    this.page = pages[0] ?? (await ctx.newPage());

    await this.page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });

    // Mark the login window as active
    this.loginWindowActive = true;

    // 3. Poll for successful login in the background
    this.pollForLogin().catch((err) => {
      this.logger.error(`Login polling error: ${err.message}`);
    });

    this.logger.log(`Shared login window open at ${this.wsEndpoint}`);
    return {
      wsEndpoint: this.wsEndpoint,
      message:
        'Login window opened. Log in to Facebook in the browser window that appeared. ' +
        'The session will be saved and shared with all new sessions.',
    };
  }

  /**
   * Poll for successful login and write a marker file when detected.
   */
  private async pollForLogin(): Promise<void> {
    if (!this.page) return;

    for (let i = 0; i < 120; i++) {
      // 10 minutes max
      try {
        if (!this.page || this.page.isClosed()) {
          this.logger.log('Login window closed by user');
          this.cleanupBrowser();
          return;
        }

        const url = this.page.url();
        // If we're on the Facebook home feed (not login page), we're logged in
        if (
          (url.includes('facebook.com') || url.includes('messenger.com')) &&
          !url.includes('login') &&
          !url.includes('checkpoint')
        ) {
          // Double-check by looking for a logged-in element
          const hasFeed = await this.page
            .locator('div[role="feed"], div[role="main"], a[aria-label*="ccount" i]', { hasText: '' })
            .first()
            .isVisible({ timeout: 3000 })
            .catch(() => false);

          if (hasFeed) {
            this.logger.log('Shared login successful! Writing marker file.');
            this.writeLoginMarker();
            return;
          }
        }
      } catch {
        // Page might not be ready yet
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    this.logger.warn('Login polling timed out after 10 minutes');
  }

  private writeLoginMarker(): void {
    try {
      fs.mkdirSync(this.sharedProfileDir, { recursive: true });
      fs.writeFileSync(
        path.join(this.sharedProfileDir, '.openfb_logged_in'),
        new Date().toISOString(),
      );
    } catch (err) {
      this.logger.error(`Failed to write login marker: ${(err as Error).message}`);
    }
  }

  /**
   * Close the login window browser.
   */
  async closeLoginWindow(): Promise<void> {
    await this.cleanupBrowser();
    this.killProcess();
    this.loginWindowActive = false;
    this.logger.log('Shared login window closed');
  }

  get isOpen(): boolean {
    return this.loginWindowActive;
  }

  private async cleanupBrowser(): Promise<void> {
    try {
      await this.page?.close();
    } catch {}
    try {
      await this.browser?.close();
    } catch {}
    this.page = null;
    this.browser = null;
  }

  private killProcess(): void {
    if (!this.process) return;
    try {
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    } catch {}
    this.process = null;
    this.wsEndpoint = null;
  }

  private async findFreePort(start = 9500, end = 9900): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryPort = (port: number) => {
        if (port > end) {
          reject(new Error('No free port found'));
          return;
        }
        const server = net.createServer();
        server.unref();
        server.listen(port, '127.0.0.1', () => {
          server.close(() => {
            const server6 = net.createServer();
            server6.unref();
            server6.listen(port, '::1', () => {
              server6.close(() => resolve(port));
            });
            server6.on('error', () => tryPort(port + 1));
          });
        });
        server.on('error', () => tryPort(port + 1));
      };
      tryPort(start);
    });
  }
}
