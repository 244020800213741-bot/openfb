import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SessionManagerService } from '../session/session-manager.service';

@ApiTags('Contact')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('session/:sessionId/contact')
export class ContactController {
  constructor(private readonly sessionManager: SessionManagerService) {}

  @Get(':contactId')
  @ApiOperation({ summary: 'Get contact information for a Facebook user' })
  async getContact(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.getContact(contactId);
  }
}
