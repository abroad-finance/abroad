// src/authentication.ts
import { Request } from "express";
import { sha512_224 } from "js-sha512";
import { prismaClientProvider } from "./container";

export async function expressAuthentication(
  request: Request,
  securityName: string,
) {
  if (securityName === "ApiKeyAuth") {
    return await getPartnerFromRequest(request);
  }
  throw new Error("Invalid security scheme");
}

export const getPartnerFromRequest = async (request: Request) => {
  const apiKey = request.header("X-API-Key");
  console.log("API Key:", apiKey);
  if (!apiKey) {
    throw new Error("No API key provided");
  }
  const apiKeyHash = sha512_224(apiKey);
  console.log("API Key Hash:", apiKeyHash);
  const prismaClient = await prismaClientProvider.getClient();
  const partner = await prismaClient.partner.findUnique({
    where: { apiKey: apiKeyHash },
  });
  if (!partner) {
    throw new Error("Invalid API key");
  }
  return partner;
};
