// src/stellar/stellarListener.ts
import { Horizon } from '@stellar/stellar-sdk';
import type { Channel } from 'amqplib';
import { sendMessage } from '../infrastructure/rabbitmq';
import { prismaClient } from '../infrastructure/db';

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

    // Get last saved position
    const state = await prismaClient.stellarListenerState.findUnique({
        where: { id: 'singleton' }
    });

    // Start streaming from last known position
    const cursorServer = state?.lastPagingToken ? server.payments().cursor(state.lastPagingToken) : server.payments();

    cursorServer
        .forAccount(accountId)
        .stream({
            onmessage: async (payment) => {
                if (payment.type !== 'payment' || payment.to !== accountId) return;

                // Get full transaction details
                const tx = await payment.transaction();

                // Immediately save new position
                await prismaClient.stellarListenerState.upsert({
                    where: { id: 'singleton' },
                    update: { lastPagingToken: tx.paging_token },
                    create: {
                        id: 'singleton',
                        lastPagingToken: tx.paging_token
                    },
                });

                // Forward to queue
                sendMessage(channel, queueName, tx);
            },
            onerror: (err) => console.error('Stream error:', err)
        });
}
