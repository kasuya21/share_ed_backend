import { supabase } from "../configs/supabase.config.js";

export const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: "Authorization header missing"
      });
    }

    const token = authHeader.replace("Bearer ", "");

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        message: "Invalid or expired token"
      });
    }

    req.user = data.user; // attach user

    next();

  } catch (error) {
    console.error("Auth middleware error:", error);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};
