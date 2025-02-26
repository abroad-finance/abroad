// nequi-payment.ts
import axios, { AxiosResponse } from "axios";
import { ISecretManager } from "../environment";
import { IPaymentService, ResponseNequiDispersion } from "../interfaces";

class NequiPaymentService implements IPaymentService {
  private token: string | null = null;
  private tokenExpiration: number | null = null;
  private secretManager: ISecretManager;

  public constructor({ secretManager }: { secretManager: ISecretManager }) {
    this.secretManager = secretManager;
  }

  private async getAuthToken(): Promise<string> {
    const ACCESS_KEY_NEQUI =
      await this.secretManager.getSecret("ACCESS_KEY_NEQUI");
    const SECRET_KEY_NEQUI =
      await this.secretManager.getSecret("SECRET_KEY_NEQUI");
    const URL_NEQUI_AUTH = await this.secretManager.getSecret("URL_NEQUI_AUTH");

    if (
      this.token &&
      this.tokenExpiration &&
      Date.now() < this.tokenExpiration
    ) {
      return this.token;
    }

    const key = Buffer.from(`${ACCESS_KEY_NEQUI}:${SECRET_KEY_NEQUI}`).toString(
      "base64",
    );
    const response: AxiosResponse = await axios({
      method: "POST",
      url: URL_NEQUI_AUTH,
      headers: {
        Authorization: `Basic ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (response.status !== 200 && response.status !== 201) {
      throw new Error("Nequi authentication failed");
    }

    const { access_token, expires_in } = response.data;
    this.token = access_token;
    this.tokenExpiration = Date.now() + expires_in * 1000 - 60 * 1000;

    if (!this.token || !this.tokenExpiration) {
      throw new Error("Failed to retrieve Nequi token");
    }

    return this.token;
  }

  private async makeRequest(endpoint: string, body: any): Promise<any> {
    const URL_NEQUI = await this.secretManager.getSecret("URL_NEQUI");
    const API_KEY_NEQUI = await this.secretManager.getSecret("API_KEY_NEQUI");

    const token = await this.getAuthToken();
    const response: AxiosResponse = await axios({
      method: "POST",
      url: `${URL_NEQUI}${endpoint}`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-api-key": API_KEY_NEQUI,
      },
      data: JSON.stringify(body),
    });

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Nequi request failed: ${response.status}`);
    }
    return response.data;
  }

  public sendPayment: IPaymentService["sendPayment"] = async ({
    account,
    id,
    value,
  }) => {
    const MAX_VALUE = 20_000; // COP
    if (value > MAX_VALUE) {
      throw new Error("[Nequi]: Value exceeds the maximum allowed");
    }

    const DISPERSION_CODE_NEQUI = await this.secretManager.getSecret(
      "DISPERSION_CODE_NEQUI",
    );

    const messageId = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 10),
    ).join("");
    const trackingId =
      "DAN" +
      Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");

    const body = {
      RequestMessage: {
        RequestBody: {
          any: {
            disperseFundsRQ: {
              code: DISPERSION_CODE_NEQUI,
              phoneNumber: account,
              reference1: id,
              reference2: messageId,
              reference3: messageId,
              trackingID: trackingId,
              value,
            },
          },
        },
        RequestHeader: {
          Channel: "GLK06-C001",
          ClientID: messageId,
          Destination: {
            ServiceName: "DispersionService",
            ServiceOperation: "disperseFunds",
            ServiceRegion: "C001",
            ServiceVersion: "1.0.0",
          },
          MessageID: messageId,
          RequestDate: new Date().toJSON(),
        },
      },
    };
    return this.makeRequest(
      "/dispersions/v2/-services-dispersionservice-dispersefunds",
      body,
    ) as Promise<ResponseNequiDispersion>;
  };
}

export { NequiPaymentService };
