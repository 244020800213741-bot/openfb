import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CamoufoxProcessManager } from './camoufox-process-manager';
import { CamoufoxFacebookSession } from './camoufox-facebook-session';
import type { EngineAdapter, FacebookSession } from '../interfaces/engine.interface';

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

  constructor(private readonly config: ConfigService) {}

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
    const userDataDir = this.config.get<string>('CAMOUFOX_USER_DATA_DIR') || undefined;

    const wsEndpoint = await processManager.start({
      headless,
      humanize,
      os,
      proxy: proxyUrl,
      geoip,
      locale,
      window: windowSize,
      userDataDir: userDataDir ? `${userDataDir}/${sessionId}` : undefined,
      port,
      wsPath,
    });

    this.logger.log(`Camoufox server ready at ${wsEndpoint} for session ${sessionId}`);

    // 2. Create the session and connect via Playwright
    const session = new CamoufoxFacebookSession(sessionId, label, processManager, wsEndpoint);
    await session.connect();

    return session;
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
