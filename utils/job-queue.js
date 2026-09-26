import crypto from "node:crypto";
import { prisma } from "../configs/prisma.js";
import { logError, logWarn, logInfo } from "./logger.js";

export const JOB_TYPES = Object.freeze({
  VERIFY_UPLOAD_ASSET: "VERIFY_UPLOAD_ASSET",
  CLEANUP_UPLOAD_ASSET: "CLEANUP_UPLOAD_ASSET",
  CLEANUP_UPLOAD_SESSION: "CLEANUP_UPLOAD_SESSION",
  POST_PUBLISHED_NOTIFICATION: "POST_PUBLISHED_NOTIFICATION",
  POST_ACHIEVEMENT_UPDATE: "POST_ACHIEVEMENT_UPDATE",
});

export const JOB_STATUSES = Object.freeze({
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
});

/**
 * Enqueue a new background job
 */
export async function enqueueJob(type, payload, {
  availableAt = new Date(),
  maxAttempts = 3,
  client = prisma,
} = {}) {
  const jobId = crypto.randomUUID();
  return client.backgroundJob.create({
    data: {
      id: jobId,
      type,
      payload,
      status: "PENDING",
      attempts: 0,
      max_attempts: maxAttempts,
      available_at: availableAt,
    },
  });
}

/**
 * Claim a job using PostgreSQL FOR UPDATE SKIP LOCKED
 * Guarantees no two workers grab the same job.
 * Handles lease timeout if a worker died.
 */
export async function claimNextJob({
  workerId = `worker-${process.pid}`,
  types = [],
  leaseDurationSeconds = 300,
  client = prisma,
} = {}) {
  try {
    const typesCondition = types && types.length > 0 ? types : Object.values(JOB_TYPES);

    // Atomic claim with lease recovery
    const claimedRows = await client.$queryRaw`
      UPDATE "background_jobs"
      SET "status" = 'PROCESSING'::"JobStatus",
          "locked_at" = NOW(),
          "locked_by" = ${workerId},
          "attempts" = "attempts" + 1,
          "updated_at" = NOW()
      WHERE "job_id" = (
          SELECT "job_id"
          FROM "background_jobs"
          WHERE (
            ("status" = 'PENDING'::"JobStatus" AND "available_at" <= NOW())
            OR
            ("status" = 'PROCESSING'::"JobStatus" AND "locked_at" <= NOW() - (${leaseDurationSeconds} * INTERVAL '1 second'))
          )
          AND "type" = ANY(${typesCondition}::text[])
          ORDER BY "available_at" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
      )
      RETURNING
        "job_id" AS "id",
        "type",
        "payload",
        "status",
        "attempts",
        "max_attempts",
        "available_at",
        "locked_at",
        "locked_by",
        "last_error",
        "created_at",
        "updated_at";
    `;

    return Array.isArray(claimedRows) && claimedRows.length > 0 ? claimedRows[0] : null;
  } catch (error) {
    logError("job_queue.claim_job_failed", error);
    return null;
  }
}

/**
 * Mark a job as COMPLETED
 */
export async function completeJob(jobId, { client = prisma } = {}) {
  try {
    await client.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        locked_at: null,
        locked_by: null,
      },
    });
    return true;
  } catch (error) {
    logError("job_queue.complete_job_failed", error, undefined, { jobId });
    return false;
  }
}

/**
 * Fail a job with exponential backoff and jitter, or mark as FAILED
 */
export async function failJob(job, error, { client = prisma } = {}) {
  try {
    const attempts = Number(job.attempts || 1);
    const maxAttempts = Number(job.max_attempts || 3);
    const safeErrorMessage = String(error?.message || error || "Unknown error").slice(0, 1000);

    if (attempts >= maxAttempts) {
      await client.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          last_error: safeErrorMessage,
          locked_at: null,
          locked_by: null,
        },
      });
      logWarn("job_queue.job_permanently_failed", error, undefined, {
        jobId: job.id,
        type: job.type,
        attempts,
      });
    } else {
      // Exponential backoff: (2^attempts * 1000ms) + random jitter (0-1000ms), capped at 60s
      const jitter = Math.floor(Math.random() * 1000);
      const delayMs = Math.min(60000, Math.pow(2, attempts) * 1000 + jitter);
      const nextAvailableAt = new Date(Date.now() + delayMs);

      await client.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          available_at: nextAvailableAt,
          last_error: safeErrorMessage,
          locked_at: null,
          locked_by: null,
        },
      });
      logWarn("job_queue.job_retry_scheduled", error, undefined, {
        jobId: job.id,
        type: job.type,
        attempts,
        nextAvailableAt: nextAvailableAt.toISOString(),
      });
    }
    return true;
  } catch (err) {
    logError("job_queue.fail_job_update_failed", err, undefined, { jobId: job.id });
    return false;
  }
}

/**
 * Get queue metrics for observability
 */
export async function getQueueMetrics({ client = prisma } = {}) {
  try {
    const counts = await client.backgroundJob.groupBy({
      by: ["status", "type"],
      _count: { id: true },
    });
    return counts.map(item => ({
      status: item.status,
      type: item.type,
      count: item._count.id,
    }));
  } catch (err) {
    logError("job_queue.get_metrics_failed", err);
    return [];
  }
}
