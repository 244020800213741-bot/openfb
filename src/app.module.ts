import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { SessionModule } from './modules/session/session.module';
import { MessageModule } from './modules/message/message.module';
import { ContactModule } from './modules/contact/contact.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { QueueModule } from './modules/queue/queue.module';
import { SearchModule } from './modules/search/search.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { ApiKeyGuard } from './modules/auth/api-key.guard';
import { validateConfig } from './config/configuration';

/**
 * Root application module.
 * Wires all feature modules together.
 *
 * Module dependency graph:
 *
 *   AppModule
 *   ├── ConfigModule (env validation)
 *   ├── AuthModule (API key guard)
 *   ├── SessionModule ← EngineModule ← CamoufoxFacebookFactory
 *   ├── MessageModule     → depends on SessionModule
 *   ├── ContactModule     → depends on SessionModule
 *   ├── ConversationModule → depends on SessionModule
 *   ├── WebhookModule
 *   ├── HealthModule      → depends on EngineModule + SessionModule
 *   ├── MetricsModule     → depends on SessionModule + QueueModule
 *   └── QueueModule (rate limiting)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfig as any,
    }),
    AuthModule,
    SessionModule,
    MessageModule,
    ContactModule,
    ConversationModule,
    WebhookModule,
    HealthModule,
    MetricsModule,
    QueueModule,
    SearchModule,
    MarketplaceModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
