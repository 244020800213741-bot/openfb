import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  const logger = new Logger('OpenFB');

  const app = await NestFactory.create(AppModule);

  // Apply Helmet, CORS, body limits, static serving
  await configureApp(app);

  const configService = app.get(ConfigService);
  const host = configService.get<string>('HOST') ?? '0.0.0.0';
  const port = configService.get<number>('PORT') ?? 3000;

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Global API prefix
  app.setGlobalPrefix('api');

  // Swagger / OpenAPI documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('OpenFB')
    .setDescription(
      'Open Source Facebook Messenger API Gateway — powered by Camoufox anti-detect browser.\n\n' +
        'OpenFB provides an HTTP API for Facebook Messenger automation, mirroring the\n' +
        'architecture of OpenWA but using Camoufox (patched Firefox) instead of Puppeteer.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'apiKey')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port, host);

  logger.log(``);
  logger.log(`  ╔═══════════════════════════════════════════════╗`);
  logger.log(`  ║  OpenFB — Facebook Messenger API Gateway      ║`);
  logger.log(`  ╠═══════════════════════════════════════════════╣`);
  logger.log(`  ║  Listening:  http://${host}:${port}               ║`);
  logger.log(`  ║  API docs:   http://${host}:${port}/api/docs        ║`);
  logger.log(`  ║  Engine:     Camoufox (anti-detect Firefox)    ║`);
  logger.log(`  ╚═══════════════════════════════════════════════╝`);
  logger.log(``);
}

bootstrap().catch((err) => {
  console.error('❌ Failed to start OpenFB:');
  console.error(err);
  process.exit(1);
});
