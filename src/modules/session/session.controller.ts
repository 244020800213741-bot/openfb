import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SessionManagerService, CreateSessionDto, SessionInfo } from './session-manager.service';

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
  @ApiOperation({ summary: 'Create a new Facebook session (launches Camoufox browser)' })
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
}
