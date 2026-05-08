import express from "express";
import "dotenv/config";


import authRoutes from "./routers/auth.router.js";
import shopItemRoutes from "./routers/shopItem.router.js";



const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/shop-items", shopItemRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
