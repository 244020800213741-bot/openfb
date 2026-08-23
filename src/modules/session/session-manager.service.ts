import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CamoufoxFacebookFactory } from '../../engine/adapters/camoufox-facebook.factory';
import type { FacebookSession, SessionState } from '../../engine/interfaces/engine.interface';
import { randomUUID } from 'crypto';
import { MarketplaceMonitorService } from '../marketplace/marketplace-monitor.service';
import type { MarketplaceMonitorConfig } from '../marketplace/marketplace.types';

export interface CreateSessionDto {
  label: string;
  /** Session type: "main" = normal Facebook/Messenger, "marketplace" = marketplace monitor */
  type?: 'main' | 'marketplace';
  /** Marketplace monitor config (only used when type=marketplace) */
  monitor?: MarketplaceMonitorConfig;
}

export interface SessionInfo {
  id: string;
  label: string;
  state: SessionState;
  createdAt: string;
  lastActivityAt: string;
  wsEndpoint: string;
  /** Session type */
  type?: 'main' | 'marketplace';
  /** Monitor status (if marketplace session) */
  monitor?: {
    config: MarketplaceMonitorConfig;
    lastRunAt?: string;
    nextRunAt?: string;
    lastResultCount?: number;
    totalEmailsSent?: number;
  };
}

/**
 * Manages the lifecycle of Facebook sessions.
 *
 * Each session corresponds to one Camoufox browser instance connected to
 * a Facebook account. Sessions can run concurrently up to MAX_SESSIONS.
 *
 * This mirrors OpenWA's multi-session architecture where each session
 * is an independent WhatsApp connection — here it's a Facebook/Messenger
 * connection instead.
 */
@Injectable()
export class SessionManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionManagerService.name);
  private readonly sessions = new Map<string, FacebookSession>();
  private readonly sessionMeta = new Map<string, {
    label: string;
    wsEndpoint: string;
    type: 'main' | 'marketplace';
    monitor?: {
      config: MarketplaceMonitorConfig;
      lastRunAt?: string;
      nextRunAt?: string;
      lastResultCount?: number;
      totalEmailsSent?: number;
    };
  }>();

  constructor(
    private readonly factory: CamoufoxFacebookFactory,
    private readonly config: ConfigService,
    private readonly monitorService: MarketplaceMonitorService,
  ) {}

  async createSession(dto: CreateSessionDto): Promise<SessionInfo> {
    const maxSessions = this.config.get<number>('MAX_SESSIONS')!;
    if (this.sessions.size >= maxSessions) {
      throw new Error(`Maximum concurrent sessions (${maxSessions}) reached`);
    }

    const id = randomUUID();
    this.logger.log(`Creating session "${dto.label}" (${id})`);

    const session = await this.factory.createSession(id, dto.label);

    this.sessions.set(id, session);
    this.sessionMeta.set(id, {
      label: dto.label,
      wsEndpoint: session.wsEndpoint,
      type: dto.type ?? 'main',
    });

    // If this is a marketplace monitor session, register the scheduled search
    if (dto.type === 'marketplace' && dto.monitor) {
      this.registerMonitor(id, session, dto.monitor);
    }

    return this.toSessionInfo(id, session);
  }

  private registerMonitor(
    id: string,
    session: FacebookSession,
    config: MarketplaceMonitorConfig,
  ): void {
    this.monitorService.register(id, session, config);
    this.sessionMeta.get(id)!.monitor = {
      config,
      nextRunAt: new Date(Date.now() + config.intervalMinutes * 60 * 1000).toISOString(),
    };
  }

  getSession(id: string): FacebookSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): SessionInfo[] {
    const result: SessionInfo[] = [];
    for (const [id, session] of this.sessions) {
      result.push(this.toSessionInfo(id, session));
    }
    return result;
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }
    // Unregister marketplace monitor if active
    if (this.monitorService) {
      this.monitorService.unregister(id);
    }
    await session.disconnect();
    this.sessions.delete(id);
    this.sessionMeta.delete(id);
    this.logger.log(`Session ${id} destroyed`);
  }

  async getScreenshot(id: string): Promise<string> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    const camoufoxSession = session as any;
    if (typeof camoufoxSession.getScreenshot === 'function') {
      return camoufoxSession.getScreenshot();
    }
    throw new Error('Screenshots not supported for this session type');
  }

  /**
   * Re-check whether a session is now authenticated.
   * Called after the user manually completes Facebook login/verification.
   */
  async checkAuth(id: string): Promise<{ state: SessionState }> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    const state = await session.checkAuth();
    return { state };
  }

  /**
   * Diagnostic info: current URL, page title, and state.
   * Useful for debugging login detection issues.
   */
  async diagnoseSession(id: string): Promise<{ state: string; url: string; title: string }> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    const camoufoxSession = session as any;
    if (camoufoxSession.page && typeof camoufoxSession.page.url === 'function') {
      try {
        const url = camoufoxSession.page.url();
        const title = await camoufoxSession.page.title().catch(() => 'unknown');
        return { state: session.state, url, title };
      } catch {
        return { state: session.state, url: 'error reading url', title: 'error' };
      }
    }
    return { state: session.state, url: 'no page available', title: 'none' };
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Destroying all sessions...');
    const destroyPromises: Promise<void>[] = [];
    for (const [id, session] of this.sessions) {
      destroyPromises.push(
        session.disconnect().catch((err) => {
          this.logger.error(`Error destroying session ${id}: ${err.message}`);
        }),
      );
    }
    await Promise.all(destroyPromises);
    this.sessions.clear();
    this.sessionMeta.clear();
  }

  private toSessionInfo(id: string, session: FacebookSession): SessionInfo {
    const meta = this.sessionMeta.get(id);
    const info: SessionInfo = {
      id,
      label: meta?.label ?? session.label,
      state: session.state,
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      wsEndpoint: meta?.wsEndpoint ?? session.wsEndpoint,
      type: meta?.type ?? 'main',
    };

    // Enrich with live monitor status if available
    if (meta?.type === 'marketplace' && this.monitorService) {
      const status = this.monitorService.getStatus(id);
      if (status) {
        info.monitor = {
          config: status.config,
          lastRunAt: status.lastRunAt?.toISOString(),
          nextRunAt: status.nextRunAt?.toISOString(),
          lastResultCount: status.lastResultCount,
          totalEmailsSent: status.totalEmailsSent,
        };
      }
    }

    return info;
  }
}
