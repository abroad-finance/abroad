// services/stellarListener.ts
import { Horizon } from '@stellar/stellar-sdk';
import type { Channel } from 'amqplib';
import { sendMessage } from '../infrastructure/rabbitmq';

interface ListenOptions {
    accountId: string;
    horizonUrl: string;
    channel: Channel;
    queueName: string;
}

/**
 * Listens to "payment" operations for the given accountId and
 * publishes messages to RabbitMQ for each transaction.
 */
export async function listenReceivedTransactions(options: ListenOptions) {
    const { accountId, horizonUrl, channel, queueName } = options;
    const server = new Horizon.Server(horizonUrl);

    server
        .payments()
        .cursor('now')
        .forAccount(accountId)
        .stream({
            onmessage: async (record) => {
                // We only care about payment operations for our specific account.
                if (record.type !== 'payment' || record.to !== accountId) {
                    return;
                }

                // Fetch the transaction associated with this payment.
                const txResponse = await record.transaction();

                // Publish the transaction to RabbitMQ.
                sendMessage(channel, queueName, txResponse);
            },
            onerror: (error) => {
                console.error('Stream error:', error);
            },
        });
}
