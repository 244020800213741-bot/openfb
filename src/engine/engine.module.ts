import { Module } from '@nestjs/common';
import { CamoufoxFacebookFactory } from './adapters/camoufox-facebook.factory';
import { AuthModule } from '../modules/auth/auth.module';

/**
 * Engine module — provides the Camoufox Facebook factory as a singleton.
 * Future engines (e.g. a hypothetical official Graph API adapter) would
 * be registered here, selected by config.
 */
@Module({
  imports: [AuthModule],
  providers: [CamoufoxFacebookFactory],
  exports: [CamoufoxFacebookFactory],
})
export class EngineModule {}
