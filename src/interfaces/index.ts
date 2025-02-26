import { CryptoCurrency, TargetCurrency } from "@prisma/client";

export type ResponseNequiDispersion = {
  ResponseMessage: {
    ResponseHeader: {
      Channel: string;
      ResponseDate: string;
      Status: {
        StatusCode: string;
        StatusDesc: string;
      };
      MessageID: string;
      ClientID: string;
      Destination: {
        ServiceName: string;
        ServiceOperation: string;
        ServiceRegion: string;
        ServiceVersion: string;
      };
    };
    ResponseBody: {
      any: unknown;
    };
  };
};

export interface IPaymentService {
  sendPayment({
    account,
    value,
    id,
  }: {
    account: string;
    value: number;
    id: string;
  }): Promise<ResponseNequiDispersion>;
}

export interface IExchangeRateProvider {
  getExchangeRate(
    sourceCurrency: CryptoCurrency,
    targetCurrency: TargetCurrency
  ): Promise<number>;
}