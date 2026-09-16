import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";
import { logError } from "../utils/logger.js";

const { Pool } = pkg;

const isTest =
  process.env.NODE_ENV === "test" ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.argv.some(arg => arg.includes("test")) ||
  process.execArgv.some(arg => arg.includes("test"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 20,
  min: isTest ? 0 : (Number(process.env.DB_POOL_MIN) || 2),
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT) || 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on("error", error => {
  logError("database.pool.idle_client_error", error);
});

const adapter = new PrismaPg(pool, {
  onPoolError: error => logError("database.pool.error", error),
  onConnectionError: error => logError("database.connection.error", error),
});

export const prisma = new PrismaClient({
  adapter,
});
