// src/environment/env.ts
import 'dotenv/config';

export const PROJECT_ID = process.env.PROJECT_ID || 'your-project-id';
export const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';