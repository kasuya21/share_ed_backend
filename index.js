import express from "express";
import "dotenv/config";

import authRoutes from "./routers/auth.router.js";
import shopItemRoutes from "./routers/shopItem.router.js";
import questRoutes from "./routers/quest.router.js";
import commentRoutes from "./routers/comment.router.js";
import postRoutes from "./routers/post.router.js";
import followRoutes from "./routers/follow.router.js";
import notificationRoutes from "./routers/notification.router.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/shop-items", shopItemRoutes);
app.use("/api/v1/quest", questRoutes);
app.use("/api/v1/comment", commentRoutes);
app.use("/api/v1/posts", postRoutes);
app.use("/api/v1/follow", followRoutes);
app.use("/api/v1/notifications", notificationRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
