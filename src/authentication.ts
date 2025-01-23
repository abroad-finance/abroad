// src/authentication.ts
import { Request } from 'express';
import { prismaClient } from './infrastructure/db';
import { sha512_224 } from "js-sha512"

export async function expressAuthentication(
  request: Request,
  securityName: string,
) {
  if (securityName === 'ApiKeyAuth') {
    await getPartnerFromRequest(request)

  }
  throw new Error('Invalid security scheme');
}

export const getPartnerFromRequest = async (request: Request) => {
  const apiKey = request.header('X-API-Key');
  if (!apiKey) {
    throw new Error('No API key provided');
  }
  const apiKeyHash = sha512_224(apiKey);
  const partner = await prismaClient.partner.findUnique({
    where: { apiKey: apiKeyHash }
  })
  if (!partner) {
    throw new Error('Invalid API key');
  }
  return partner
}
