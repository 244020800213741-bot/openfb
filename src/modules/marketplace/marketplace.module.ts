import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [MarketplaceController],
})
export class MarketplaceModule {}
