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
  host: z.string().default('0.0.0.0'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),

  apiKey: z.string().min(1),
  jwtSecret: z.string().min(1),

  // Camoufox engine
  camoufoxBinary: z.string().optional().default(''),
  camoufoxHeadless: headlessSchema,
  camoufoxHumanize: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return true as boolean | number;
      if (v === 'true') return true;
      if (v === 'false') return false;
      const n = parseFloat(v);
      return isNaN(n) ? true : n;
    }),
  camoufoxOs: z.string().default('windows'),
  camoufoxProxy: z.string().optional().default(''),
  camoufoxGeoip: z.string().optional().default(''),
  camoufoxUserDataDir: z.string().default('./data/profiles'),
  camoufoxWindowSize: z.string().optional().default(''),
  camoufoxLocale: z.string().optional().default(''),

  // Sessions
  maxSessions: z.coerce.number().int().min(1).default(5),
  sessionIdleTimeout: z.coerce.number().int().min(0).default(30),

  // Webhooks
  webhookUrl: z.string().url().optional().or(z.literal('')).default(''),
  webhookSecret: z.string().optional().default(''),

  // Rate limiting
  rateLimitMessagesPerMin: z.coerce.number().int().min(1).default(60),
  queueConcurrency: z.coerce.number().int().min(1).default(1),

  // Dashboard
  dashboardEnabled: boolString.default('true'),
  dashboardUsername: z.string().default('admin'),
  dashboardPassword: z.string().default('admin'),
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
