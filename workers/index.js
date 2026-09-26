import { claimNextJob, completeJob, failJob, JOB_TYPES } from "../utils/job-queue.js";
import {
  handleCleanupUploadAsset,
  handleCleanupUploadSession,
  handlePostPublishedNotification,
  handlePostAchievementUpdate,
  handleVerifyUploadAsset,
} from "./handlers.js";
import { WORKER_CONCURRENCY } from "../configs/upload-workspace.constants.js";
import { logInfo, logError, logWarn } from "../utils/logger.js";

const HANDLERS = {
  [JOB_TYPES.CLEANUP_UPLOAD_ASSET]: handleCleanupUploadAsset,
  [JOB_TYPES.CLEANUP_UPLOAD_SESSION]: handleCleanupUploadSession,
  [JOB_TYPES.POST_PUBLISHED_NOTIFICATION]: handlePostPublishedNotification,
  [JOB_TYPES.POST_ACHIEVEMENT_UPDATE]: handlePostAchievementUpdate,
  [JOB_TYPES.VERIFY_UPLOAD_ASSET]: handleVerifyUploadAsset,
};

let isShuttingDown = false;
const activeWorkers = new Set();

/**
 * Worker pool loop for specific job types
 */
async function startWorkerLane(name, allowedTypes, concurrency) {
  for (let i = 0; i < concurrency; i++) {
    const workerId = `${name}-${process.pid}-${i + 1}`;
    runWorkerLoop(workerId, allowedTypes).catch(err => {
      logError("worker.loop_fatal_error", err, undefined, { workerId });
    });
  }
}

async function runWorkerLoop(workerId, allowedTypes) {
  while (!isShuttingDown) {
    let job = null;
    try {
      job = await claimNextJob({ workerId, types: allowedTypes, leaseDurationSeconds: 300 });
      if (!job) {
        // Idle: sleep 500ms before checking again
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      activeWorkers.add(job.id);
      const handler = HANDLERS[job.type];
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`);
      }

      await handler(job.payload);
      await completeJob(job.id);
    } catch (err) {
      if (job) {
        await failJob(job, err);
      }
    } finally {
      if (job) {
        activeWorkers.delete(job.id);
      }
    }
  }
}

async function main() {
  logInfo("worker.started", undefined, {
    pid: process.pid,
    concurrency: WORKER_CONCURRENCY,
  });

  // Start worker lanes with configured concurrencies
  await Promise.all([
    startWorkerLane("verify", [JOB_TYPES.VERIFY_UPLOAD_ASSET], WORKER_CONCURRENCY.VERIFICATION),
    startWorkerLane("cleanup", [JOB_TYPES.CLEANUP_UPLOAD_ASSET, JOB_TYPES.CLEANUP_UPLOAD_SESSION], WORKER_CONCURRENCY.CLEANUP),
    startWorkerLane("notify", [JOB_TYPES.POST_PUBLISHED_NOTIFICATION], WORKER_CONCURRENCY.NOTIFICATION),
    startWorkerLane("achieve", [JOB_TYPES.POST_ACHIEVEMENT_UPDATE], WORKER_CONCURRENCY.ACHIEVEMENT),
  ]);
}

function handleShutdown(signal) {
  logInfo("worker.shutdown_requested", undefined, { signal });
  isShuttingDown = true;

  const checkInterval = setInterval(() => {
    if (activeWorkers.size === 0) {
      clearInterval(checkInterval);
      logInfo("worker.graceful_shutdown_complete");
      process.exit(0);
    }
  }, 200);

  // Force exit after 10s if stuck
  setTimeout(() => {
    logWarn("worker.forced_shutdown_timeout", undefined, undefined, {
      activeCount: activeWorkers.size,
    });
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

if (process.argv[1]?.endsWith("workers/index.js") || process.argv[1]?.endsWith("workers\\index.js")) {
  main().catch(err => {
    logError("worker.main_crash", err);
    process.exit(1);
  });
}
