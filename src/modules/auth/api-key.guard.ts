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
