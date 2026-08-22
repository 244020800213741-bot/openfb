import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from './api-key.guard';
import { SharedLoginService } from './shared-login.service';

/**
 * Controller for the shared Facebook login window.
 *
 * Separated from SessionController to avoid route conflicts between
 * /session/login-fb/* and /session/:id.
 */
@ApiTags('Login')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('session/login-fb')
export class SharedLoginController {
  constructor(private readonly sharedLogin: SharedLoginService) {}

  @Post('open')
  @ApiOperation({
    summary: 'Open a browser window to log in to Facebook manually. The login is saved and shared with all new sessions.',
  })
  async open() {
    return this.sharedLogin.openLoginWindow();
  }

  @Post('close')
  @ApiOperation({ summary: 'Close the shared login browser window' })
  async close() {
    await this.sharedLogin.closeLoginWindow();
    return { success: true, message: 'Login window closed' };
  }

  @Get('status')
  @ApiOperation({ summary: 'Check if the shared Facebook login is active and saved' })
  status() {
    return {
      windowOpen: this.sharedLogin.isOpen,
      hasSharedLogin: this.sharedLogin.hasSharedProfile,
      profileDir: this.sharedLogin.profileDir,
    };
  }
}
