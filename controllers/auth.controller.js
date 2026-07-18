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

    res.json({
      ...dbUser,
      avatar_url: dbUser.profile_image,
      user_metadata: {
        banner_url: dbUser.profile_banner,
        wallpaper_url: dbUser.wallpaper,
        facebook_url: dbUser.social_links?.facebook || null,
        instagram_url: dbUser.social_links?.instagram || null,
        discord_url: dbUser.social_links?.discord || null,
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  }
};
