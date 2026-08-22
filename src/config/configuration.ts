import { z } from 'zod';

/**
 * OpenFB configuration schema — validated at startup via Zod.
 * Mirrors the pluggable architecture of OpenWA: all engine options
 * are driven by environment variables, not application code.
 */

const boolString = z
  .string()
  .transform((v) => v === 'true')
  .pipe(z.boolean());

const headlessSchema = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return true as boolean | 'virtual';
    if (v === 'virtual') return 'virtual' as const;
    return v === 'true';
  });

export const ConfigSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  API_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(1),

  // Camoufox engine
  CAMOUFOX_BINARY: z.string().optional().default(''),
  CAMOUFOX_HEADLESS: headlessSchema,
  CAMOUFOX_HUMANIZE: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return true as boolean | number;
      if (v === 'true') return true;
      if (v === 'false') return false;
      const n = parseFloat(v);
      return isNaN(n) ? true : n;
    }),
  CAMOUFOX_OS: z.string().default('windows'),
  CAMOUFOX_PROXY: z.string().optional().default(''),
  CAMOUFOX_GEOIP: z.string().optional().default(''),
  CAMOUFOX_USER_DATA_DIR: z.string().default('./data/profiles'),
  CAMOUFOX_WINDOW_SIZE: z.string().optional().default(''),
  CAMOUFOX_LOCALE: z.string().optional().default(''),

  // Sessions
  MAX_SESSIONS: z.coerce.number().int().min(1).default(5),
  SESSION_IDLE_TIMEOUT: z.coerce.number().int().min(0).default(30),

  // Webhooks
  WEBHOOK_URL: z.string().url().optional().or(z.literal('')).default(''),
  WEBHOOK_SECRET: z.string().optional().default(''),

  // Rate limiting
  RATE_LIMIT_MESSAGES_PER_MIN: z.coerce.number().int().min(1).default(60),
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).default(1),

  // Dashboard
  DASHBOARD_ENABLED: boolString.default(true),
  DASHBOARD_USERNAME: z.string().default('admin'),
  DASHBOARD_PASSWORD: z.string().default('admin'),

  // Email (Gmail) — optional, used for marketplace monitor alerts
  GMAIL_USER: z.string().optional().default(''),
  GMAIL_APP_PASSWORD: z.string().optional().default(''),
  GMAIL_TO: z.string().optional().default(''),
});

export type OpenFbConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): OpenFbConfig {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error('[openfb] Invalid configuration:\n' + result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
    process.exit(1);
  }
  return result.data;
}

/**
 * Validate function for NestJS ConfigModule.forRoot({ validate }).
 * Receives the raw env record and returns the parsed config object.
 */
export function validateConfig(env: Record<string, unknown>): OpenFbConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      '[openfb] Invalid configuration:\n' +
        result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  return result.data;
}
