import express from "express";
import cors from "cors";
import "dotenv/config";
import swaggerUi from "swagger-ui-express";
import { swaggerDocument } from "./configs/swagger.js";
import { initCronJobs } from "./utils/cron.js";
import { seedMilestonesAndRewards } from "./utils/milestone.helper.js";

import authRoutes from "./routers/auth.router.js";
import milestoneRoutes from "./routers/milestone.router.js";

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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:4173",
    "https://share-ed-backend-6jer.onrender.com",
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve API Documentation (Swagger UI)
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  swaggerOptions: {
    persistAuthorization: true,   // จำ Bearer token ไว้หลัง refresh
    displayRequestDuration: true, // แสดงเวลา response
  },
}));

// Serve raw OpenAPI JSON → Postman import ได้จาก URL นี้
app.get("/api-docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerDocument);
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/milestones", milestoneRoutes);

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

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Share-ED API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f0f1a;
      font-family: 'Segoe UI', sans-serif;
      color: #fff;
    }
    .card {
      text-align: center;
      padding: 56px 64px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 24px;
      backdrop-filter: blur(12px);
      box-shadow: 0 24px 64px rgba(0,0,0,0.4);
    }
    .badge {
      display: inline-block;
      background: rgba(99,102,241,0.2);
      color: #a5b4fc;
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      padding: 4px 14px;
      margin-bottom: 24px;
    }
    h1 {
      font-size: 40px;
      font-weight: 700;
      background: linear-gradient(135deg, #fff 40%, #a5b4fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 12px;
    }
    p {
      color: rgba(255,255,255,0.45);
      font-size: 15px;
      margin-bottom: 36px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 14px 32px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      border-radius: 12px;
      text-decoration: none;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 8px 24px rgba(99,102,241,0.4);
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 32px rgba(99,102,241,0.6);
    }
    .dot {
      width: 8px; height: 8px;
      background: #4ade80;
      border-radius: 50%;
      display: inline-block;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><span class="dot"></span> &nbsp;Running</div>
    <h1>Share-ED API</h1>
    <p>RESTful API server is up and ready to serve requests.</p>
    <a class="btn" href="/api-docs">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
      Open API Docs
    </a>
  </div>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  initCronJobs();
  seedMilestonesAndRewards();
});