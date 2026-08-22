import { Module } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';
import { SessionController } from './session.controller';
import { EngineModule } from '../../engine/engine.module';

@Module({
  imports: [EngineModule],
  providers: [SessionManagerService],
  controllers: [SessionController],
  exports: [SessionManagerService],
})
export class SessionModule {}
