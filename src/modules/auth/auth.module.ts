import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { SharedLoginService } from './shared-login.service';
import { SharedLoginController } from './shared-login.controller';

@Module({
  providers: [ApiKeyGuard, SharedLoginService],
  controllers: [SharedLoginController],
  exports: [ApiKeyGuard, SharedLoginService],
})
export class AuthModule {}
