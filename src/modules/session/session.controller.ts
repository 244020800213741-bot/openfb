import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SessionManagerService } from './session-manager.service';
import type { SessionInfo } from './session-manager.service';
import { CreateSessionDto } from './dto/create-session.dto';

@ApiTags('Session')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('session')
export class SessionController {
  constructor(private readonly sessionManager: SessionManagerService) {}

  @Get()
  @ApiOperation({ summary: 'List all active sessions' })
  listSessions(): SessionInfo[] {
    return this.sessionManager.listSessions();
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new session — "main" (Facebook/Messenger) or "marketplace" (monitor with scheduled searches + email alerts)',
  })
  async createSession(@Body() dto: CreateSessionDto): Promise<SessionInfo> {
    return this.sessionManager.createSession(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get session details' })
  getSession(@Param('id') id: string): SessionInfo {
    const session = this.sessionManager.getSession(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return this.sessionManager.listSessions().find((s) => s.id === id)!;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Disconnect and destroy a session' })
  async destroySession(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.sessionManager.destroySession(id);
    return { success: true };
  }

  @Get(':id/screenshot')
  @ApiOperation({ summary: 'Get a screenshot of the browser (for login verification)' })
  async getScreenshot(@Param('id') id: string): Promise<{ image: string }> {
    const image = await this.sessionManager.getScreenshot(id);
    return { image };
  }

  @Post(':id/check-auth')
  @ApiOperation({
    summary: 'Re-check whether the session is now authenticated (after completing Facebook login/verification)',
  })
  async checkAuth(@Param('id') id: string): Promise<{ state: string }> {
    const result = await this.sessionManager.checkAuth(id);
    return { state: result.state };
  }

  @Get(':id/diagnose')
  @ApiOperation({ summary: 'Get diagnostic info about the session browser (URL, title, state)' })
  async diagnose(@Param('id') id: string): Promise<{ state: string; url: string; title: string }> {
    const info = await this.sessionManager.diagnoseSession(id);
    return info;
  }
}
