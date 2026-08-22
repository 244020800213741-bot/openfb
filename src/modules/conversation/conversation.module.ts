import { Module } from '@nestjs/common';
import { ConversationController } from './conversation.controller';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [ConversationController],
})
export class ConversationModule {}
