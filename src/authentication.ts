// src/authentication.ts
import { Request } from 'express';
import { TsoaResponse } from 'tsoa';

export function expressAuthentication(
  request: Request,
  securityName: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scopes?: string[]
): Promise<any> {
  if (securityName === 'ApiKeyAuth') {
    const apiKey = request.header('X-API-Key');
    // Perform your real API key checks here...
    // For now, let's just accept any API key for demonstration:
    if (!apiKey || apiKey.length === 0) {
      return Promise.reject(new Error('No API key provided.'));
    }
    return Promise.resolve(true);
  }
  return Promise.reject(new Error('Unknown security name'));
}
