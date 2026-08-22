/**
 * Export the OpenAPI specification from the NestJS app.
 * Usage: ts-node scripts/export-openapi.ts openapi.json
 *
 * Mirrors OpenWA's openapi:export script — generates the spec at build
 * time so it can be version-controlled and used to generate SDKs.
 */
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { AppModule } from '../src/app.module';

async function exportOpenApi(outputPath: string): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  const config = new DocumentBuilder()
    .setTitle('OpenFB')
    .setDescription(
      'Open Source Facebook Messenger API Gateway — powered by Camoufox anti-detect browser.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'apiKey')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  writeFileSync(outputPath, JSON.stringify(document, null, 2));
  console.log(`[openfb] OpenAPI spec exported to ${outputPath}`);

  await app.close();
}

const output = process.argv[2] ?? 'openapi.json';
exportOpenApi(output).catch((err) => {
  console.error('[openfb] Failed to export OpenAPI:', err);
  process.exit(1);
});
