// src/services/PaymentServiceFactory.ts
import { inject, injectable, named } from "inversify";
import { TYPES } from "../types";
import { IPaymentServiceFactory } from "../interfaces/IPaymentServiceFactory";
import { IPaymentService } from "../interfaces/IPaymentService";
import { PaymentMethod } from "@prisma/client";

@injectable()
export class PaymentServiceFactory implements IPaymentServiceFactory {
  constructor(
    @inject(TYPES.IPaymentService)
    @named("movii")
    private moviiPaymentService: IPaymentService,
    @inject(TYPES.IPaymentService)
    @named("nequi")
    private nequiPaymentService: IPaymentService,
  ) {}

  public getPaymentService(paymentMethod: PaymentMethod): IPaymentService {
    switch (paymentMethod.toLowerCase()) {
      case PaymentMethod.MOVII:
        return this.moviiPaymentService;
      case PaymentMethod.NEQUI:
        return this.nequiPaymentService;
      default:
        throw new Error(`Unsupported payment method: ${paymentMethod}`);
    }
  }
}
