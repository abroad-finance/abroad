export interface ISlackNotifier {
  sendMessage(message: string): Promise<void>
}
