import axios from "axios";
import { inject } from "inversify";
import { TYPES } from "../types";
import { ISecretManager } from "../interfaces/ISecretManager";

export interface ISlackNotifier {
  sendMessage(message: string): Promise<void>;
}

export class SlackNotifier implements ISlackNotifier {
  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) {}

  async sendMessage(message: string): Promise<void> {
    try {
      const webhookUrl =
        await this.secretManager.getSecret("SLACK_WEBHOOK_URL");

      if (!webhookUrl) {
        console.error("Slack webhook URL not found in secrets.");
        return;
      }

      await axios.post(webhookUrl, { text: message });
      console.log("Message sent to Slack successfully.");
    } catch (error) {
      console.error("Error sending message to Slack:", error);
      throw error;
    }
  }
}
