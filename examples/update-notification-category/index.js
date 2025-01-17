/* eslint-disable @typescript-eslint/no-var-requires */
require('dotenv').config();

const { Defender } = require('@openzeppelin/defender-sdk');

async function main() {
  const creds = { apiKey: process.env.API_KEY, apiSecret: process.env.API_SECRET };
  const client = new Defender(creds);

  let notification;
  // use an existing notification channel
  const notificationChannels = await client.notificationChannel.list();
  if (notificationChannels.length > 0) {
    // Select your desired notification channel
    notification = notificationChannels[0];
  } else {
    // OR create a new notification channel
    notification = await client.notificationChannel.create({
      type: 'email',
      name: 'MyEmailNotification',
      config: {
        emails: ['john@example.com'],
      },
      paused: false,
    });
  }

  const getExistingCategory = (await client.monitor.listNotificationCategories())[0];

  const category = {
    ...getExistingCategory,
    description: 'Attach this category to high-risk monitors',
    notificationIds: [{ notificationId: notification.notificationId, type: notification.type }],
  };
  // call update with the request parameters
  const response = await client.monitor.updateNotificationCategory(getExistingCategory.categoryId, category);
  console.log(response);
}

if (require.main === module) {
  main().catch(console.error);
}
