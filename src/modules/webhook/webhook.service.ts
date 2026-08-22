import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

export interface WebhookPayload {
  event: string;
  sessionId: string;
  data: any;
  timestamp: string;
}

/**
 * Delivers events to external webhook URLs.
 *
 * Mirrors OpenWA's webhook system: when an incoming message (or other event)
 * is detected, it is POSTed to the configured webhook URL with an HMAC
 * signature so the receiver can verify authenticity.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly webhookUrl: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.webhookUrl = config.get<string>('WEBHOOK_URL') ?? '';
    this.webhookSecret = config.get<string>('WEBHOOK_SECRET') ?? '';
  }

  isEnabled(): boolean {
    return this.webhookUrl.length > 0;
  }

  async deliver(payload: WebhookPayload): Promise<void> {
    if (!this.isEnabled()) return;

    const body = JSON.stringify(payload);
    const signature = this.sign(body);

    try {
      // Use the global fetch (available in Node 22+)
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenFB-Signature': signature,
          'X-OpenFB-Event': payload.event,
        },
        body,
      });

      if (!response.ok) {
        this.logger.warn(
          `Webhook delivery failed: ${response.status} ${response.statusText}`,
        );
      }
    } catch (err) {
      this.logger.error(`Webhook delivery error: ${(err as Error).message}`);
    }
  }

  private sign(body: string): string {
    if (!this.webhookSecret) return '';
    return createHmac('sha256', this.webhookSecret).update(body).digest('hex');
  }
}
