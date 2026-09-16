import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";
import { logError } from "../utils/logger.js";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool, {
  onPoolError: error => logError("database.pool.error", error),
  onConnectionError: error => logError("database.connection.error", error),
});

export const prisma = new PrismaClient({
  adapter,
});
