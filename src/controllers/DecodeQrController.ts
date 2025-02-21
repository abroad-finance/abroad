// src/controllers/DecodeQrController.ts
import {
  Controller,
  Post,
  Route,
  Body,
  Security,
  Response,
  SuccessResponse,
} from "tsoa";

interface DecodeQrRequest {
  qr_data: string;
}

interface DecodeQrResponse {
  target_currency: string;
  payment_method: string;
  account_number: string;
}

@Route("decode-qr")
@Security("ApiKeyAuth")
export class DecodeQrController extends Controller {
  /**
   * Decodes the scanned QR data and returns payment details
   * required for the transaction.
   *
   * @param requestBody - The scanned QR data from the user.
   * @returns An object containing `target_currency`, `payment_method`, and `account_number`.
   */
  @Post()
  @SuccessResponse("200", "QR code decoded successfully")
  @Response("400", "Bad Request")
  @Response("401", "Unauthorized")
  @Response("404", "Not Found")
  @Response("500", "Internal Server Error")
  public async decodeQr(
    @Body() requestBody: DecodeQrRequest,
  ): Promise<DecodeQrResponse> {
    // Dummy response (no real decoding logic here)
    return {
      target_currency: "COP",
      payment_method: "NEQUI",
      account_number: "123456789",
    };
  }
}
