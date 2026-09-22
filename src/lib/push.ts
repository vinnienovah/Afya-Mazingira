// Web push for alerts. Delivery needs the VAPID keys and the push service;
// until that is set up nothing is sent and the count is 0.

/** Push a notification to each browser the user subscribed; returns how many were sent. */
export async function sendPushToUser(
  userId: number,
  payload: { title: string; body: string; url?: string },
): Promise<number> {
  return 0;
}
