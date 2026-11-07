import { Worker, Queue } from "bullmq";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const connection = { url: redisUrl };

const queue = new Queue("team-assistant", { connection });

const API_URL = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
const INTERNAL_API_TOKEN =
  process.env.INTERNAL_API_TOKEN ?? "dev-internal-token";

const STANDUP_PROMPT_CRON =
  process.env.STANDUP_PROMPT_CRON ?? "0 9 * * 1-5";
const STANDUP_PROMPT_TIMEZONE =
  process.env.STANDUP_PROMPT_TIMEZONE ?? "Asia/Jakarta";
const STANDUP_REMINDER_CRON =
  process.env.STANDUP_REMINDER_CRON ?? "30 10 * * 1-5";
const STANDUP_REMINDER_TIMEZONE =
  process.env.STANDUP_REMINDER_TIMEZONE ?? "Asia/Jakarta";

async function callApi(path: string) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": INTERNAL_API_TOKEN,
    },
    body: JSON.stringify({}),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `API ${path} failed: ${response.status} ${JSON.stringify(body)}`,
    );
  }
  return body;
}

logger.info("Worker starting...");

const worker = new Worker(
  "team-assistant",
  async (job) => {
    switch (job.name) {
      case "standup-prompts": {
        const result = await callApi("/standups/trigger");
        logger.info({ result }, "Standup prompts triggered");
        return result;
      }
      case "standup-reminders": {
        const result = await callApi("/standups/reminders");
        logger.info({ result }, "Standup reminders triggered");
        return result;
      }
      default:
        logger.info({ name: job.name, id: job.id }, "Processing job");
        return null;
    }
  },
  { connection },
);

worker.on("completed", (job) => {
  logger.info({ id: job.id }, "Job completed");
});

worker.on("failed", (job, err) => {
  logger.error({ id: job?.id, err }, "Job failed");
});

if (import.meta.main) {
  await queue.add(
    "standup-prompts",
    {},
    {
      repeat: {
        pattern: STANDUP_PROMPT_CRON,
        tz: STANDUP_PROMPT_TIMEZONE,
      },
    },
  );
  await queue.add(
    "standup-reminders",
    {},
    {
      repeat: {
        pattern: STANDUP_REMINDER_CRON,
        tz: STANDUP_REMINDER_TIMEZONE,
      },
    },
  );

  const repeatable = await queue.getRepeatableJobs();
  logger.info({ repeatable }, "Repeatable jobs registered");
  logger.info("Worker running");
}

export { queue, worker };
