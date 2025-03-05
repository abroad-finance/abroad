import { ILogger } from "../interfaces";

export class ConsoleLogger implements ILogger {
  info(message: string, ...optionalParams: any[]): void {
    console.log("INFO:", message, ...optionalParams);
  }

  warn(message: string, ...optionalParams: any[]): void {
    console.log("WARN:", message, ...optionalParams);
  }

  error(message: string, ...optionalParams: any[]): void {
    console.log("ERROR:", message, ...optionalParams);
  }
}
