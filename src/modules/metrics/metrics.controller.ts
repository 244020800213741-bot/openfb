import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionManagerService } from '../session/session-manager.service';
import { RateLimiterService } from '../queue/rate-limiter.service';

@ApiTags('Metrics')
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get gateway metrics' })
  async getMetrics() {
    const sessions = this.sessionManager.listSessions();
    const rateLimits = sessions.map((s) => ({
      sessionId: s.id,
      ...this.rateLimiter.getUsage(s.id),
    }));

    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      sessions: {
        total: sessions.length,
        authenticated: sessions.filter((s) => s.state === 'authenticated').length,
        waiting: sessions.filter((s) => s.state === 'waiting_for_login').length,
        error: sessions.filter((s) => s.state === 'error').length,
      },
      rateLimits,
      timestamp: new Date().toISOString(),
    };
  }
}
