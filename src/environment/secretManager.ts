// services/secretManager.ts
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { PROJECT_ID } from './env';

/**
 * Fetch a secret value from Google Cloud Secret Manager.
 */
export async function getSecret(secretName: string,): Promise<string> {
    if (!PROJECT_ID) {
        throw new Error('Environment variable GCP_PROJECT_ID is not set.');
    }

    const client = new SecretManagerServiceClient();
    const name = `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`;

    const [accessResponse] = await client.accessSecretVersion({ name });
    const payload = accessResponse.payload?.data?.toString();

    if (!payload) {
        throw new Error('No secret payload found for secret ' + secretName);
    }

    return payload;
}
