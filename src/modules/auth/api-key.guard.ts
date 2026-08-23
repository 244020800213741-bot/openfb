import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * API Key authentication guard.
 * Validates requests via either:
 *   - Header:  x-api-key: <key>
 *   - Query:   ?apiKey=<key>
 *
 * Mirrors OpenWA's API key authentication pattern.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const url = request.url || '';

    // Allow static assets and the dashboard UI (no API key required)
    if (url.startsWith('/api/docs') || url.startsWith('/api/docs-json')) {
      return true;
    }

    const apiKey =
      (request.headers['x-api-key'] as string) ||
      (request.query.apiKey as string) ||
      '';

    const expectedKey = this.config.get<string>('API_KEY');

    if (!expectedKey || apiKey === expectedKey) {
      return true;
    }

    throw new UnauthorizedException('Invalid or missing API key');
  }
}
