// src/services/movii.ts
import axios from "axios";
import { inject } from "inversify";
import { TYPES } from "../types";
import { ISecretManager } from "../interfaces/ISecretManager";
import { TargetCurrency } from "@prisma/client";
import { IPaymentService } from "../interfaces/IPaymentService";

export class MoviiPaymentService implements IPaymentService {
  public readonly fixedFee = 1190;
  public readonly percentageFee = 0.0;
  public readonly currency = TargetCurrency.COP;

  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) {}

  private async getToken(): Promise<string> {
    const baseUrl = await this.secretManager.getSecret("MOVII_BASE_URL");
    const clientId = await this.secretManager.getSecret("MOVII_CLIENT_ID");
    const clientSecret = await this.secretManager.getSecret(
      "MOVII_CLIENT_SECRET",
    );

    const url = `${baseUrl}/transfiya/oauth/token`;

    // Build URL-encoded parameters
    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("client_secret", clientSecret);
    params.append("grand_type", "client_credentials");

    try {
      const response = await axios.post(url, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      // Assuming the token is returned as access_token
      return response.data.access_token;
    } catch (error) {
      console.error("Error fetching token:", error);
      throw error;
    }
  }

  public sendPayment: IPaymentService["sendPayment"] = async ({
    account,
    value,
  }) => {
    const baseUrl = await this.secretManager.getSecret("MOVII_BASE_URL");
    const signerHandler = await this.secretManager.getSecret(
      "MOVII_SIGNER_HANDLER",
    );
    const apiKey = await this.secretManager.getSecret("MOVII_API_KEY");

    const token = await this.getToken();

    const url = `${baseUrl}/transfiya/v2/transfers`;

    const data = {
      source: signerHandler,
      target: account,
      symbol: "$tin",
      amount: value.toString(),
      labels: {
        type: "SEND",
        description: "Abroad transfer",
        domain: "tin",
        transactionPurpose: "TRANSFER",
        numberOfTransactions: "1",
        sourceChannel: "OTR",
        tx_id: "",
      },
    };

    const headers = {
      "x-api-key": apiKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    try {
      const response = await axios.post(url, data, { headers });
      // Check the response to see if the transfer was created successfully
      if (response.data?.error?.code === 0) {
        return { success: true, transactionId: response.data.transferId };
      } else {
        console.error("API returned an error:", response.data);
        return { success: false };
      }
    } catch (error) {
      console.error("Error sending payment:", error);
      return { success: false };
    }
  };

  public verifyAccount({
    account,
    bankCode,
  }: {
    account: string;
    bankCode: string;
  }): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
}
