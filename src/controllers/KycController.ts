// src/controllers/KycController.ts
import { KycStatus } from "@prisma/client";
import {
  Controller,
  Post,
  Route,
  Body,
  Security,
  Response,
  SuccessResponse,
} from "tsoa";

interface KycRequest {
  user_id: string;
}

interface KycResponse {
  user_id: string;
  kyc_status: KycStatus;
  kyc_link: string;
}

@Route("kyc")
@Security("ApiKeyAuth")
export class KycController extends Controller {
  /**
   * Checks or initiates the KYC flow for a given user.
   *
   * @param requestBody - Contains the user identifier (`user_id`).
   * @returns Current KYC status and a link to complete KYC if needed.
   */
  @Post()
  @SuccessResponse("200", "KYC status response")
  @Response("400", "Bad Request")
  @Response("401", "Unauthorized")
  @Response("404", "Not Found")
  @Response("500", "Internal Server Error")
  public async checkKyc(@Body() requestBody: KycRequest): Promise<KycResponse> {
    // Dummy response
    return {
      user_id: requestBody.user_id,
      kyc_status: "PENDING",
      kyc_link: "https://kycprovider.com/start?user=" + requestBody.user_id,
    };
  }
}
