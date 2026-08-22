import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CamoufoxFacebookFactory } from '../../engine/adapters/camoufox-facebook.factory';
import { SessionManagerService } from '../session/session-manager.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly factory: CamoufoxFacebookFactory,
    private readonly sessionManager: SessionManagerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check — verify Camoufox engine availability' })
  async check() {
    const engineHealth = await this.factory.healthCheck();
    const sessions = this.sessionManager.listSessions();
    return {
      status: engineHealth.healthy ? 'ok' : 'degraded',
      engine: {
        name: this.factory.name,
        healthy: engineHealth.healthy,
        details: engineHealth.details,
      },
      sessions: {
        active: sessions.length,
        authenticated: sessions.filter((s) => s.state === 'authenticated').length,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
