import { Injectable, OnModuleInit } from '@nestjs/common';
import { PubSub } from '@google-cloud/pubsub';

@Injectable()
export class PubSubService implements OnModuleInit {
  private pubsub: PubSub;

  onModuleInit() {
    this.pubsub = new PubSub({
      projectId: process.env.GCP_PROJECT,
    });
  }

  async publish(topicName: string, data: any): Promise<string> {
    try {
      const topic = this.pubsub.topic(topicName);
      const messageId = await topic.publishMessage({
        json: data,
        attributes: {
          eventType: topicName,
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV || 'development',
        },
      });

      console.log(`Published message ${messageId} to topic ${topicName}`);
      return messageId;
    } catch (error) {
      console.error(`Failed to publish message to ${topicName}:`, error);
      throw error;
    }
  }

  async subscribe(
    subscriptionName: string,
    handler: (message: any) => Promise<void>,
  ): Promise<void> {
    const subscription = this.pubsub.subscription(subscriptionName);

    subscription.on('message', async (message) => {
      try {
        const data = JSON.parse(message.data.toString());
        await handler(data);
        message.ack();
      } catch (error) {
        console.error('Failed to process message:', error);
        message.nack();
      }
    });

    subscription.on('error', (error) => {
      console.error('Subscription error:', error);
    });
  }

  async createTopic(topicName: string): Promise<void> {
    try {
      const [topic] = await this.pubsub.createTopic(topicName);
      console.log(`Topic ${topic.name} created`);
    } catch (error) {
      if (error.code !== 6) {
        // 6 = ALREADY_EXISTS
        throw error;
      }
    }
  }

  async createSubscription(
    topicName: string,
    subscriptionName: string,
    options?: any,
  ): Promise<void> {
    try {
      const [subscription] = await this.pubsub
        .topic(topicName)
        .createSubscription(subscriptionName, options);
      console.log(`Subscription ${subscription.name} created`);
    } catch (error) {
      if (error.code !== 6) {
        // 6 = ALREADY_EXISTS
        throw error;
      }
    }
  }
}

