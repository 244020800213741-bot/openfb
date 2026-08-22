import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [SearchController],
})
export class SearchModule {}
