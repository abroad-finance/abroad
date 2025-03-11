import { TargetCurrency } from "@prisma/client";

export interface IPaymentService {
  readonly fixedFee: number;
  readonly percentageFee: number;
  readonly currency: TargetCurrency;

  sendPayment({
    account,
    value,
    id,
  }: {
    account: string;
    value: number;
    id: string;
  }): Promise<
    | {
        success: false;
      }
    | {
        success: true;
        transactionId: string;
      }
  >;

  verifyAccount({
    account,
    bankCode,
  }: {
    account: string;
    bankCode: string;
  }): Promise<boolean>;
}
