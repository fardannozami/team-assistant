import { Worker, Queue } from "bullmq";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const connection = { url: redisUrl };

const queue = new Queue("team-assistant", { connection });

logger.info("Worker starting...");

const worker = new Worker(
  "team-assistant",
  async (job) => {
    logger.info({ name: job.name, id: job.id }, "Processing job");
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
  logger.info("Worker running");
}

export { queue, worker };
