import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as net from 'net';
import { EventEmitter } from 'events';

/**
 * Manages the lifecycle of a Camoufox remote server process.
 *
 * Camoufox is a Python-based anti-detect Firefox build. It exposes a
 * Playwright-compatible WebSocket endpoint that any Playwright client
 * (including Node.js) can connect to. This class:
 *
 *  1. Spawns the Python launcher (`launch_server.py`) as a child process.
 *  2. Waits for the WebSocket endpoint to appear in stdout.
 *  3. Provides the endpoint URL to callers.
 *  4. Handles graceful shutdown of the browser process.
 *
 * Architecture (same pattern OpenWA uses for whatsapp-web.js / Baileys,
 * but the "engine" is Camoufox instead of Puppeteer or a WS library):
 *
 *   ┌───────────────────────────┐     ┌─────────────────────────────┐
 *   │  Node.js (OpenFB API)     │     │  Python child process        │
 *   │  ─────────────────────    │     │  ──────────────────────────  │
 *   │  Playwright client ───────┼──WS─│  Camoufox remote server      │
 *   │  (connect over WS)        │     │  (patched Firefox binary)    │
 *   └───────────────────────────┘     └─────────────────────────────┘
 */
export class CamoufoxProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private wsEndpoint: string | null = null;
  private starting: Promise<string> | null = null;
  private readonly launcherScript: string;

  constructor(launcherScript?: string) {
    super();
    this.launcherScript =
      launcherScript ??
      path.join(__dirname, '..', '..', '..', 'scripts', 'camoufox-launcher', 'launch_server.py');
  }

  /**
   * Start the Camoufox server and return the WebSocket endpoint URL.
   * Idempotent: if already started, returns the existing endpoint.
   */
  async start(options: {
    headless?: boolean | 'virtual';
    humanize?: boolean | number;
    os?: string;
    proxy?: string;
    geoip?: string;
    locale?: string;
    window?: string;
    userDataDir?: string;
    port?: number;
    wsPath?: string;
  }): Promise<string> {
    if (this.wsEndpoint) return this.wsEndpoint;
    if (this.starting) return this.starting;

    this.starting = this.doStart(options);
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async doStart(options: {
    headless?: boolean | 'virtual';
    humanize?: boolean | number;
    os?: string;
    proxy?: string;
    geoip?: string;
    locale?: string;
    window?: string;
    userDataDir?: string;
    port?: number;
    wsPath?: string;
  }): Promise<string> {
    const args: string[] = [this.launcherScript];

    if (options.headless !== undefined) {
      const h =
        options.headless === 'virtual' ? 'virtual' : options.headless ? 'true' : 'false';
      args.push('--headless', h);
    }
    if (options.humanize !== undefined) {
      args.push('--humanize', String(options.humanize));
    }
    if (options.os) args.push('--os', options.os);
    if (options.proxy) args.push('--proxy', options.proxy);
    if (options.geoip) args.push('--geoip', options.geoip);
    if (options.locale) args.push('--locale', options.locale);
    if (options.window) args.push('--window', options.window);
    if (options.userDataDir) args.push('--user-data-dir', options.userDataDir);
    if (options.port) args.push('--port', String(options.port));
    if (options.wsPath) args.push('--ws-path', options.wsPath);

    return new Promise<string>((resolve, reject) => {
      this.process = spawn('python', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      const timeout = setTimeout(() => {
        reject(new Error('[openfb] Camoufox server did not start within 60 seconds'));
        this.kill();
      }, 60_000);

      this.process.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        process.stdout.write(`[camoufox] ${text}`);

        // Camoufox prints: "Websocket endpoint: ws://localhost:PORT/PATH"
        const match = text.match(/(ws:\/\/[^\s]+)/);
        if (match && !this.wsEndpoint) {
          this.wsEndpoint = match[1];
          clearTimeout(timeout);
          this.emit('ready', this.wsEndpoint);
          resolve(this.wsEndpoint);
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        process.stderr.write(`[camoufox:err] ${data.toString()}`);
      });

      this.process.on('exit', (code, signal) => {
        clearTimeout(timeout);
        this.wsEndpoint = null;
        this.process = null;
        this.emit('exit', { code, signal });
        if (!this.wsEndpoint && code !== 0) {
          reject(
            new Error(`[openfb] Camoufox process exited with code ${code} before becoming ready`),
          );
        }
      });

      this.process.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`[openfb] Failed to spawn Camoufox: ${err.message}`));
      });
    });
  }

  /**
   * Find a free TCP port for the Camoufox server.
   * Camoufox binds on IPv6 (::1) by default, so we probe both
   * IPv4 and IPv6 to avoid false "free" results.
   */
  static async findFreePort(start = 9000, end = 9999): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryPort = (port: number) => {
        if (port > end) {
          reject(new Error('No free port found'));
          return;
        }
        // Probe IPv4 first
        const server4 = net.createServer();
        server4.unref();
        server4.listen(port, '127.0.0.1', () => {
          server4.close(() => {
            // Then probe IPv6
            const server6 = net.createServer();
            server6.unref();
            server6.listen(port, '::1', () => {
              server6.close(() => resolve(port));
            });
            server6.on('error', () => tryPort(port + 1));
          });
        });
        server4.on('error', () => tryPort(port + 1));
      };
      tryPort(start);
    });
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  get endpoint(): string | null {
    return this.wsEndpoint;
  }

  async kill(): Promise<void> {
    if (!this.process) return;
    return new Promise((resolve) => {
      this.process!.once('exit', () => resolve());
      this.process!.kill('SIGTERM');
      // Force-kill after 10s
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 10_000);
    });
  }
}
