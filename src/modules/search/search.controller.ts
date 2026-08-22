import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SessionManagerService } from '../session/session-manager.service';

@ApiTags('Search')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('session/:sessionId/search')
export class SearchController {
  constructor(private readonly sessionManager: SessionManagerService) {}

  @Get()
  @ApiOperation({ summary: 'Search conversations, contacts, or messages on Facebook' })
  async search(
    @Param('sessionId') sessionId: string,
    @Query('q') query: string,
    @Query('type') type?: string,
  ) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.search(query, (type as any) ?? 'conversations');
  }
}
