import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [MessageController],
})
export class MessageModule {}
