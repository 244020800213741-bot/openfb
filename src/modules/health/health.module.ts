import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { EngineModule } from '../../engine/engine.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [EngineModule, SessionModule],
  controllers: [HealthController],
})
export class HealthModule {}
