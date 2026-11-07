import { Worker, Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const connection = { url: redisUrl };

const queue = new Queue("team-assistant", { connection });

console.log("Worker starting...");

const worker = new Worker(
  "team-assistant",
  async (job) => {
    console.log("Processing job", job.name, job.id);
  },
  { connection },
);

worker.on("completed", (job) => {
  console.log("Job completed", job.id);
});

worker.on("failed", (job, err) => {
  console.error("Job failed", job?.id, err);
});

if (import.meta.main) {
  console.log("Worker running");
}

export { queue, worker };
