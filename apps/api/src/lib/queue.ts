import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Producer-side handle on the scheduler queue. The worker consumes these
 * jobs; the API only enqueues (e.g. manual schedule triggers).
 */
export const schedulerQueue = new Queue("team-assistant", {
  connection: { url: redisUrl },
});
