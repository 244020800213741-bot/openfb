import { Controller, Post, Body, Headers, HttpCode, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

/**
 * Inbound webhook controller — receives external events and routes them.
 * Also provides an endpoint to test webhook delivery.
 */
@ApiTags('Webhook')
@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a test event to the configured webhook URL' })
  async testWebhook() {
    await this.webhookService.deliver({
      event: 'test',
      sessionId: 'none',
      data: { message: 'OpenFB webhook test' },
      timestamp: new Date().toISOString(),
    });
    return { success: true, message: 'Test webhook sent' };
  }

  @Post('status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check if webhook delivery is enabled' })
  status() {
    return { enabled: this.webhookService.isEnabled() };
  }
}
