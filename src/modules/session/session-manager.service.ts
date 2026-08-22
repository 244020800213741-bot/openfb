import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CamoufoxFacebookFactory } from '../../engine/adapters/camoufox-facebook.factory';
import type { FacebookSession, SessionState } from '../../engine/interfaces/engine.interface';
import { randomUUID } from 'crypto';

export interface CreateSessionDto {
  label: string;
  email?: string;
  password?: string;
}

export interface SessionInfo {
  id: string;
  label: string;
  state: SessionState;
  createdAt: string;
  lastActivityAt: string;
  wsEndpoint: string;
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
  private readonly sessionMeta = new Map<string, { label: string; wsEndpoint: string }>();

  constructor(
    private readonly factory: CamoufoxFacebookFactory,
    private readonly config: ConfigService,
  ) {}

  async createSession(dto: CreateSessionDto): Promise<SessionInfo> {
    const maxSessions = this.config.get<number>('MAX_SESSIONS')!;
    if (this.sessions.size >= maxSessions) {
      throw new Error(`Maximum concurrent sessions (${maxSessions}) reached`);
    }

    const id = randomUUID();
    this.logger.log(`Creating session "${dto.label}" (${id})`);

    const session = await this.factory.createSession(id, dto.label);

    // If credentials are provided, attempt login
    if (dto.email && dto.password) {
      const camoufoxSession = session as any;
      if (typeof camoufoxSession.loginWithCredentials === 'function') {
        await camoufoxSession.loginWithCredentials(dto.email, dto.password);
      }
    }

    this.sessions.set(id, session);
    this.sessionMeta.set(id, {
      label: dto.label,
      wsEndpoint: session.wsEndpoint,
    });

    return this.toSessionInfo(id, session);
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
    return {
      id,
      label: meta?.label ?? session.label,
      state: session.state,
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      wsEndpoint: meta?.wsEndpoint ?? session.wsEndpoint,
    };
  }
}
