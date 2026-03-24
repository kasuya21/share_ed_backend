import { supabase } from "../configs/supabase.config.js";
import { prisma } from "../configs/prisma.js";

export const verifyUser = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ message: "No token" });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const authUser = data.user;

    let dbUser = await prisma.user.findUnique({
      where: { id: authUser.id },
    });

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: {
          id: authUser.id,
          email: authUser.email,
          username: authUser.email.split("@")[0],
        },
      });
    }

    res.json(dbUser);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  }
};
