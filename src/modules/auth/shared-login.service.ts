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
  private readonly storageStatePath: string;
  private process: ChildProcess | null = null;
  private wsEndpoint: string | null = null;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private loginWindowActive = false;

  constructor(private readonly config: ConfigService) {
    const baseDir = this.config.get<string>('CAMOUFOX_USER_DATA_DIR') || './data/profiles';
    this.sharedProfileDir = `${baseDir}/_shared_login`;
    this.storageStatePath = path.join(this.sharedProfileDir, 'storage_state.json');
  }

  get profileDir(): string {
    return this.sharedProfileDir;
  }

  /**
   * Path to the saved Playwright storage state (cookies + localStorage).
   * This is what the factory loads into new sessions to inherit the login.
   */
  get storageStateFile(): string {
    return this.storageStatePath;
  }

  /**
   * Whether the shared login profile exists on disk.
   * Checks for the storage state JSON file, which contains the actual
   * cookies and localStorage needed to authenticate new sessions.
   */
  get hasSharedProfile(): boolean {
    try {
      if (!fs.existsSync(this.storageStatePath)) {
        return false;
      }
      // Verify the storage state file has actual cookies
      const raw = fs.readFileSync(this.storageStatePath, 'utf-8');
      const state = JSON.parse(raw);
      if (!state.cookies || state.cookies.length === 0) {
        return false;
      }
      // Check for Facebook session cookies — c_user and xs are ONLY set
      // after a genuine login. datr/fr/sb/wd are set on the anonymous
      // login page and must NOT be treated as "logged in".
      const hasCUser = state.cookies.some((c: any) => c.name === 'c_user');
      const hasXs = state.cookies.some((c: any) => c.name === 'xs');
      return hasCUser && hasXs;
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

    // Respect the CAMOUFOX_HEADLESS config so the login window works on
    // headless servers (virtual = Xvfb, true = headless). Hardcoding
    // 'false' crashes on servers without a display.
    const headlessMode = this.config.get<string>('CAMOUFOX_HEADLESS');
    const headlessArg = headlessMode ?? 'false';

    const args = [
      launcherScript,
      '--headless', headlessArg,
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

    // ── Clear ALL cookies, connected or not ──
    // Start from a clean slate so a stale/blocked session never masquerades
    // as a fresh login. Also wipe the on-disk storage state file.
    try {
      await ctx.clearCookies();
      this.logger.log('Cleared all browser cookies before opening Facebook.');
    } catch (err) {
      this.logger.warn(`Could not clear browser cookies: ${(err as Error).message}`);
    }
    try {
      if (fs.existsSync(this.storageStatePath)) {
        fs.unlinkSync(this.storageStatePath);
        this.logger.log('Deleted old storage_state.json before fresh login.');
      }
      const markerFile = path.join(this.sharedProfileDir, '.openfb_logged_in');
      if (fs.existsSync(markerFile)) {
        fs.unlinkSync(markerFile);
      }
    } catch (err) {
      this.logger.warn(`Could not clean old login files: ${(err as Error).message}`);
    }

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
      novncPort: 6080,
      message:
        'Login window opened inside the container virtual display. ' +
        'Open the noVNC viewer (port 6080) to see and interact with the Facebook login page. ' +
        'Log in manually — the session will be saved and shared with all new sessions.',
    };
  }

  /**
   * Poll for successful login, then save the session and close Facebook.
   *
   * When c_user + xs appear (the cookies that are ONLY set after a genuine
   * login), we save the storage state, give Firefox a moment to flush any
   * remaining session data, and then close the login window automatically.
   * Closing the window IS the "login success" signal to the user — once the
   * browser window disappears, the login is saved and shared.
   */
  private async pollForLogin(): Promise<void> {
    if (!this.page) return;

    let loginDetected = false;
    let stableChecks = 0;
    const requiredStableChecks = 2; // Confirm login is stable, not transient

    for (let i = 0; i < 120; i++) {
      // 10 minutes max
      try {
        if (!this.page || this.page.isClosed()) {
          this.logger.log('Login window closed by user');
          await this.cleanupBrowser();
          return;
        }

        if (loginDetected) continue;

        const url = this.page.url();
        // If we're on a login or checkpoint page, definitely not logged in yet
        if (url.includes('login') || url.includes('checkpoint')) {
          stableChecks = 0;
          continue;
        }

        // Check for Facebook session cookies — c_user and xs are ONLY set
        // after a genuine login. DOM selectors are unreliable because the
        // facebook.com login page itself renders div[role="navigation"],
        // a[aria-label="Facebook"], etc., which caused false positives.
        const cookies = await this.page.context().cookies();
        const hasCUser = cookies.some((c) => c.name === 'c_user');
        const hasXs = cookies.some((c) => c.name === 'xs');

        if (hasCUser && hasXs) {
          stableChecks++;
          if (stableChecks < requiredStableChecks) {
            // Cookies present but let's confirm on the next poll that they
            // persist (avoid acting on a transient checkpoint redirect).
            continue;
          }

          this.logger.log('Shared login successful! Saving session and closing window.');
          loginDetected = true;

          // 1. Save the full browser storage state (cookies + localStorage)
          await this.writeLoginMarker();

          // 2. Give Firefox a moment to finish writing profile data to disk
          await new Promise((r) => setTimeout(r, 3000));

          // 3. Save storage state one more time to capture any cookies that
          //    were set late (e.g. after a redirect following login).
          await this.writeLoginMarker();

          // 4. Close the login window automatically — this is the success
          //    signal. The window disappears when the login is saved.
          this.logger.log('Closing login window automatically (login success).');
          await this.closeLoginWindow();
          return;
        } else {
          stableChecks = 0;
        }
      } catch {
        // Page might not be ready yet
        stableChecks = 0;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    this.logger.warn('Login polling timed out after 10 minutes');
  }

  private async writeLoginMarker(): Promise<void> {
    try {
      fs.mkdirSync(this.sharedProfileDir, { recursive: true });

      // Save the full browser storage state (cookies + localStorage) to a
      // JSON file using Playwright's storageState() API. This is the reliable
      // way to persist login — it does not depend on Firefox's internal
      // profile persistence (which may not flush in time).
      if (this.page && !this.page.isClosed()) {
        const state = await this.page.context().storageState();
        fs.writeFileSync(this.storageStatePath, JSON.stringify(state, null, 2));
        const cookieCount = state.cookies?.length ?? 0;
        this.logger.log(
          `Storage state saved to ${this.storageStatePath} (${cookieCount} cookies)`,
        );
      }

      // Also write the marker file for backwards compatibility
      fs.writeFileSync(
        path.join(this.sharedProfileDir, '.openfb_logged_in'),
        new Date().toISOString(),
      );
      this.logger.log(`Login marker written to ${this.sharedProfileDir}`);
    } catch (err) {
      this.logger.error(`Failed to write login marker: ${(err as Error).message}`);
    }
  }

  /**
   * Close the login window browser.
   * Closes the browser gracefully first (so Firefox flushes cookies/session
   * to the persistent profile), then kills the Camoufox Python process.
   */
  async closeLoginWindow(): Promise<void> {
    // 1. Close the page and browser gracefully — this triggers Firefox to
    //    write cookies, localStorage, and session data to disk.
    await this.cleanupBrowser();

    // 2. Give Firefox a moment to finish writing profile data
    await new Promise((r) => setTimeout(r, 3000));

    // 3. Now kill the Camoufox Python process
    this.killProcess();
    this.loginWindowActive = false;
    this.logger.log('Shared login window closed (profile saved to disk)');
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
