import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SessionManagerService } from '../session/session-manager.service';

@ApiTags('Conversation')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('session/:sessionId/conversation')
export class ConversationController {
  constructor(private readonly sessionManager: SessionManagerService) {}

  @Get()
  @ApiOperation({ summary: 'List recent Facebook conversations' })
  async listConversations(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: number,
  ) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.getConversations(limit);
  }

  @Get(':chatId/messages')
  @ApiOperation({ summary: 'Get messages from a specific conversation' })
  async getMessages(
    @Param('sessionId') sessionId: string,
    @Param('chatId') chatId: string,
    @Query('limit') limit?: number,
  ) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.getMessages(chatId, limit);
  }

  @Post('markAsRead/:chatId')
  @ApiOperation({ summary: 'Mark a conversation as read' })
  async markAsRead(
    @Param('sessionId') sessionId: string,
    @Param('chatId') chatId: string,
  ) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    await session.markAsRead(chatId);
    return { success: true };
  }
}
