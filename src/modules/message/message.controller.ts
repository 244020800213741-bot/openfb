import { Body, Controller, Post, Param, UseGuards, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SessionManagerService } from '../session/session-manager.service';
import { SendTextDto, SendMediaDto } from './dto/send-message.dto';

@ApiTags('Message')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('session/:sessionId/message')
export class MessageController {
  constructor(private readonly sessionManager: SessionManagerService) {}

  @Post('text')
  @ApiOperation({ summary: 'Send a text message to a Facebook chat' })
  async sendText(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendTextDto,
  ) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.sendText(dto.chatId, dto.text);
  }

  @Post('media')
  @ApiOperation({ summary: 'Send media (image, file, audio) to a Facebook chat' })
  async sendMedia(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMediaDto,
  ) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.sendMedia(dto.chatId, {
      type: dto.type as any,
      data: dto.data,
      filename: dto.filename,
      caption: dto.caption,
      mimeType: dto.mimeType,
    });
  }
}
