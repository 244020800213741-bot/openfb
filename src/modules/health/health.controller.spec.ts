import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';

/**
 * Smoke test: HealthController can be instantiated and returns a shape.
 * Full integration tests require a running Camoufox browser.
 */
describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      controllers: [HealthController],
    })
      .overrideProvider('CamoufoxFacebookFactory')
      .useValue({
        name: 'camoufox',
        healthCheck: async () => ({ healthy: false, details: 'test mode' }),
      })
      .overrideProvider('SessionManagerService')
      .useValue({ listSessions: () => [] })
      .compile();

    controller = moduleRef.get(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return health status', async () => {
    const result = await controller.check();
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('engine');
    expect(result).toHaveProperty('sessions');
    expect(result).toHaveProperty('timestamp');
  });
});
