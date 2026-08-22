import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { EventListenerService } from './event-listener.service';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  providers: [WebhookService, EventListenerService],
  controllers: [WebhookController],
  exports: [WebhookService, EventListenerService],
})
export class WebhookModule {}
