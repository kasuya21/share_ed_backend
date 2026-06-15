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
      include: {
        purchases: {
          include: {
            item: true,
          },
        },
      },
    });

    const avatarUrl = authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || null;

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: {
          id: authUser.id,
          email: authUser.email,
          username: authUser.email.split("@")[0],
          profile_image: avatarUrl,
        },
        include: {
          purchases: {
            include: {
              item: true,
            },
          },
        },
      });
    } else {
      let needsUpdate = false;
      const updateData = {};

      if (!dbUser.profile_image && avatarUrl) {
        updateData.profile_image = avatarUrl;
        needsUpdate = true;
      }

      if (needsUpdate) {
        dbUser = await prisma.user.update({
          where: { id: authUser.id },
          data: updateData,
          include: {
            purchases: {
              include: {
                item: true,
              },
            },
          },
        });
      }
    }

    res.json(dbUser);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  }
};
