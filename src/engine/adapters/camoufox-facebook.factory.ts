import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CamoufoxProcessManager } from './camoufox-process-manager';
import { CamoufoxFacebookSession } from './camoufox-facebook-session';
import type { EngineAdapter, FacebookSession } from '../interfaces/engine.interface';
import { SharedLoginService } from '../../modules/auth/shared-login.service';

/**
 * Factory that creates Camoufox-backed Facebook sessions.
 *
 * This is the OpenFB equivalent of OpenWA's engine.factory.ts.
 * It manages Camoufox process lifecycle and creates session instances
 * that connect to the Camoufox remote server via Playwright.
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  SessionManager (NestJS module)                             │
 *   │    └── CamoufoxFacebookSession(s)                           │
 *   │          └── Playwright firefox.connectOverCDP(wsEndpoint)   │
 *   │                └── Camoufox remote server (Python child)     │
 *   │                      └── Patched Firefox binary             │
 *   │                            └── messenger.com DOM             │
 *   └─────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class CamoufoxFacebookFactory implements EngineAdapter {
  readonly name = 'camoufox';
  private readonly logger = new Logger(CamoufoxFacebookFactory.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sharedLogin: SharedLoginService,
  ) {}

  async createSession(sessionId: string, label: string): Promise<FacebookSession> {
    this.logger.log(`Creating Camoufox session "${label}" (${sessionId})`);

    // 1. Start a dedicated Camoufox server process for this session
    const processManager = new CamoufoxProcessManager();

    // Find a free port for the Camoufox server
    const port = await CamoufoxProcessManager.findFreePort();
    const wsPath = `openfb-${sessionId}`;

    const proxyUrl = this.config.get<string>('CAMOUFOX_PROXY') || undefined;
    const geoipRaw = this.config.get<string>('CAMOUFOX_GEOIP') || '';
    const geoip = geoipRaw === 'auto' ? 'auto' : geoipRaw || undefined;

    // Read config values via ConfigService (NestJS injectable)
    const headlessRaw = this.config.get<string>('CAMOUFOX_HEADLESS');
    let headless: boolean | 'virtual' = true;
    if (headlessRaw === 'virtual') headless = 'virtual';
    else if (headlessRaw === 'false') headless = false;

    const humanizeRaw = this.config.get<string>('CAMOUFOX_HUMANIZE');
    let humanize: boolean | number = true;
    if (humanizeRaw === 'false') humanize = false;
    else if (humanizeRaw && humanizeRaw !== 'true') {
      const n = parseFloat(humanizeRaw);
      if (!isNaN(n)) humanize = n;
    }

    const os = this.config.get<string>('CAMOUFOX_OS') || 'windows';
    const locale = this.config.get<string>('CAMOUFOX_LOCALE') || undefined;
    const windowSize = this.config.get<string>('CAMOUFOX_WINDOW_SIZE') || undefined;
    const userDataDir = this.config.get<string>('CAMOUFOX_USER_DATA_DIR') || './data/profiles';
    const sessionProfileDir = `${userDataDir}/${sessionId}`;

    // If a shared login profile exists, copy it into this session's profile
    // so the new session inherits the Facebook login.
    if (this.sharedLogin.hasSharedProfile) {
      this.logger.log(`Copying shared login profile to session ${sessionId}`);
      this.copyProfile(this.sharedLogin.profileDir, sessionProfileDir);
    }

    const wsEndpoint = await processManager.start({
      headless,
      humanize,
      os,
      proxy: proxyUrl,
      geoip,
      locale,
      window: windowSize,
      userDataDir: sessionProfileDir,
      port,
      wsPath,
    });

    this.logger.log(`Camoufox server ready at ${wsEndpoint} for session ${sessionId}`);

    // 2. Create the session and connect via Playwright
    const session = new CamoufoxFacebookSession(sessionId, label, processManager, wsEndpoint);
    try {
      await session.connect();
    } catch (err) {
      // If connection fails, kill the Camoufox process so it doesn't leak
      this.logger.error(`Session connection failed, cleaning up Camoufox process: ${(err as Error).message}`);
      await processManager.kill();
      throw err;
    }

    return session;
  }

  /**
   * Recursively copy a profile directory, skipping lock files that would
   * conflict with a running browser.
   */
  private copyProfile(src: string, dest: string): void {
    try {
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(dest, { recursive: true });

      const skipFiles = new Set(['.openfb_logged_in', 'lock', 'parent.lock', 'SingletonLock']);

      const copyRecursive = (currentSrc: string, currentDest: string) => {
        const entries = fs.readdirSync(currentSrc, { withFileTypes: true });
        for (const entry of entries) {
          if (skipFiles.has(entry.name)) continue;
          const srcPath = path.join(currentSrc, entry.name);
          const destPath = path.join(currentDest, entry.name);
          if (entry.isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            copyRecursive(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      };

      copyRecursive(src, dest);
      this.logger.log(`Profile copied from ${src} to ${dest}`);
    } catch (err) {
      this.logger.warn(`Failed to copy shared profile: ${(err as Error).message}. Session will start fresh.`);
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; details: string }> {
    try {
      const { execSync } = await import('child_process');
      execSync('python -c "import camoufox"', { stdio: 'pipe' });
      return {
        healthy: true,
        details: 'Camoufox Python package is installed and ready',
      };
    } catch {
      return {
        healthy: false,
        details:
          'Camoufox Python package not found. Run: pip install -U "camoufox[geoip]" && python -m camoufox fetch',
      };
    }
  }
}
