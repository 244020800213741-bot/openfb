import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SessionManagerService } from '../session/session-manager.service';
import { WebhookService } from '../webhook/webhook.service';
import type { FacebookMessage } from '../../engine/interfaces/engine.interface';

/**
 * Bridges session events (incoming messages, state changes) to the webhook
 * delivery system. When a session receives a new message, this service
 * forwards it to the configured webhook URL.
 *
 * Mirrors OpenWA's event-bus → webhook bridge pattern.
 */
@Injectable()
export class EventListenerService implements OnModuleInit {
  private readonly logger = new Logger(EventListenerService.name);

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly webhookService: WebhookService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Note: In a full implementation, we would subscribe to each session's
    // EventEmitter when it's created. For now, this is a placeholder that
    // logs the intent. The actual wiring happens in SessionManagerService
    // when sessions are created.
    this.logger.log('Event listener service initialized');
  }

  /**
   * Called when a new message is received on a session.
   * Forwards it to the webhook if enabled.
   */
  async onIncomingMessage(sessionId: string, message: FacebookMessage): Promise<void> {
    this.logger.log(`Incoming message on session ${sessionId} from ${message.senderId}`);

    if (this.webhookService.isEnabled()) {
      await this.webhookService.deliver({
        event: 'message.received',
        sessionId,
        data: message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Called when a session state changes.
   */
  async onSessionStateChange(sessionId: string, state: string): Promise<void> {
    this.logger.log(`Session ${sessionId} state changed to: ${state}`);

    if (this.webhookService.isEnabled()) {
      await this.webhookService.deliver({
        event: 'session.state_change',
        sessionId,
        data: { state },
        timestamp: new Date().toISOString(),
      });
    }
  }
}
