import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import compression from "compression";
import "dotenv/config";
import { initCronJobs } from "./utils/cron.js";
import { initIO } from "./configs/socket.js";

import authRoutes from "./routers/auth.router.js";
import achievementRoutes from "./routers/achievement.router.js";

import commentRoutes from "./routers/comment.router.js";
import postRoutes from "./routers/post.router.js";

import followRoutes from "./routers/follow.router.js";
import notificationRoutes from "./routers/notification.router.js";

import likeRoutes from "./routers/like.router.js";
import bookmarkRoutes from "./routers/bookmark.router.js";
import userRoutes from "./routers/user.router.js";

import reportRoutes from "./routers/report.router.js";
import moderatorRoutes from "./routers/moderator.router.js";
import adminRoutes from "./routers/admin.router.js";
import categoryRoutes from "./routers/category.router.js";

import { supabase } from "./configs/supabase.config.js";
import { prisma } from "./configs/prisma.js";
import { socketAuth, joinOwnRoom } from "./middlewares/socket.middleware.js";
import { securityHeaders, rateLimit, errorHandler } from "./utils/security.js";
import { requestLogging, logError } from "./utils/logger.js";

const app = express();
app.disable("x-powered-by");
app.use(requestLogging);
app.use(securityHeaders);
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, nosnippet");
  next();
});
const PORT = process.env.PORT || 3000;

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:4173",
    "https://share-ed-backend-6jer.onrender.com",
    "https://share-ed-frontend-gamma.vercel.app",
    "https://share-ed-frontend-iota.vercel.app",
    "http://share-ed.s3-website-us-east-1.amazonaws.com",
    "https://share-ed.online"
  ],
  credentials: true,
  exposedHeaders: ["X-Request-ID"],
};

app.use(cors(corsOptions));
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers["x-no-compression"]) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

const httpServer = createServer(app);
httpServer.on("error", error => {
  logError("server.http.error", error);
  process.exitCode = 1;
});

const io = new Server(httpServer, {
  cors: corsOptions
});

// เซฟ io instance ให้ notification.helper ใช้ได้ผ่าน getIO()
initIO(io);

io.use(socketAuth(supabase, prisma));
io.on("connection", joinOwnRoom);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb", parameterLimit: 100 }));

app.use("/api/v1/auth", rateLimit());
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/achievements", achievementRoutes);

app.use("/api/v1/comment", commentRoutes);
app.use("/api/v1/posts", postRoutes);

app.use("/api/v1/follow", followRoutes);
app.use("/api/v1/notifications", notificationRoutes);

app.use("/api/v1/likes", likeRoutes);
app.use("/api/v1/bookmarks", bookmarkRoutes);
app.use("/api/v1/users", userRoutes);

app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/moderator", moderatorRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/categories", categoryRoutes);

// Minimal public response: no documentation, routes, or infrastructure details.
app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
});

app.use((req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.use(errorHandler);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${httpServer.address().port}`);
  initCronJobs();
});
