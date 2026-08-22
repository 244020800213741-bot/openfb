import { ConfigSchema, loadConfig } from './configuration';

/**
 * Tests for the Zod configuration schema.
 * Verifies that environment variables are parsed correctly.
 */
describe('Configuration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should apply defaults for missing values', () => {
    process.env = {
      API_KEY: 'test-key',
      JWT_SECRET: 'test-jwt',
    };
    const config = loadConfig();
    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.MAX_SESSIONS).toBe(5);
    expect(config.CAMOUFOX_HEADLESS).toBe(true);
    expect(config.CAMOUFOX_OS).toBe('windows');
  });

  it('should parse custom values', () => {
    process.env = {
      API_KEY: 'my-key',
      JWT_SECRET: 'my-jwt',
      PORT: '8080',
      MAX_SESSIONS: '10',
      CAMOUFOX_HEADLESS: 'false',
      CAMOUFOX_OS: 'macos,linux',
    };
    const config = loadConfig();
    expect(config.PORT).toBe(8080);
    expect(config.MAX_SESSIONS).toBe(10);
    expect(config.CAMOUFOX_HEADLESS).toBe(false);
    expect(config.CAMOUFOX_OS).toBe('macos,linux');
  });

  it('should parse virtual headless mode', () => {
    process.env = {
      API_KEY: 'k',
      JWT_SECRET: 'j',
      CAMOUFOX_HEADLESS: 'virtual',
    };
    const config = loadConfig();
    expect(config.CAMOUFOX_HEADLESS).toBe('virtual');
  });

  it('should fail without required API_KEY', () => {
    process.env = { JWT_SECRET: 'j' };
    expect(() => loadConfig()).toThrow();
  });
});
