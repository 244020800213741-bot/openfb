import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { SessionModule } from '../session/session.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [SessionModule, QueueModule],
  controllers: [MetricsController],
})
export class MetricsModule {}
