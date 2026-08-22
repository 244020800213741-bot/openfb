import { Module } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';
import { SessionController } from './session.controller';
import { EngineModule } from '../../engine/engine.module';
import { EmailModule } from '../email/email.module';
import { MarketplaceMonitorService } from '../marketplace/marketplace-monitor.service';

@Module({
  imports: [EngineModule, EmailModule],
  providers: [SessionManagerService, MarketplaceMonitorService],
  controllers: [SessionController],
  exports: [SessionManagerService, MarketplaceMonitorService],
})
export class SessionModule {}
