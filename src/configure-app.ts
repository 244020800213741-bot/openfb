import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';

/**
 * Configures middleware and security settings for the NestJS app.
 * Mirrors OpenWA's configure-app.ts pattern.
 */
export async function configureApp(app: INestApplication): Promise<void> {
  // Enable CORS
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  // Security headers via Helmet
  app.use(helmet({ contentSecurityPolicy: false }));

  // Body parsing with limits
  app.use(json({ limit: '50mb' })); // Large limit for base64 media uploads
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Trust proxy (important when running behind Docker/nginx)
  const expressInstance = app.getHttpAdapter().getInstance() as any;
  if (typeof expressInstance.set === 'function') {
    expressInstance.set('trust proxy', 1);
  }
}
