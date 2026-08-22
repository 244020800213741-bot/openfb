import { z } from 'zod';

/**
 * Options for launching a Camoufox browser session.
 * These are translated into CLI arguments or Python-launcher kwargs
 * when spawning the Camoufox remote server.
 */
export const CamoufoxLaunchOptionsSchema = z.object({
  headless: z.union([z.boolean(), z.literal('virtual')]).default(true),
  humanize: z.union([z.boolean(), z.number()]).default(true),
  os: z.union([z.string(), z.array(z.string())]).default('windows'),
  proxy: z
    .object({
      server: z.string(),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .optional(),
  geoip: z.union([z.string(), z.boolean()]).optional(),
  locale: z.string().optional(),
  window: z.tuple([z.number(), z.number()]).optional(),
  port: z.number().optional(),
  wsPath: z.string().optional(),
  userDataDir: z.string().optional(),
  addons: z.array(z.string()).optional(),
  blockImages: z.boolean().optional(),
  blockWebrtc: z.boolean().optional(),
});

export type CamoufoxLaunchOptions = z.infer<typeof CamoufoxLaunchOptionsSchema>;
