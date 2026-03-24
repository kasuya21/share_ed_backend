import express from "express";
import "dotenv/config";

// import userRouter from "./routes/user.routes.js";
import authRoutes from "./routers/auth.router.js";



const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// routes
// app.use("/api/v1/user", userRouter);
app.use("/api/v1/auth", authRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
