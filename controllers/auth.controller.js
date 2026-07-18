import { supabase } from "../configs/supabase.config.js";
import { prisma } from "../configs/prisma.js";

// ============================================================
// POST /api/v1/auth/register
// สมัครสมาชิกใหม่ (Guest -> Member)
// ============================================================
export const registerUser = async (req, res) => {
  try {
    const { email, password, confirmPassword, username, education_level, age } = req.body;

    // 1. ตรวจสอบข้อมูลบังคับกรอก (Mandatory Fields)
    if (!email || !password || !confirmPassword || !username || !education_level || age === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: "กรุณาระบุข้อมูลให้ครบถ้วน" 
      });
    }

    // 2. ความปลอดภัยของรหัสผ่าน
    if (password.length < 8) {
      return res.status(400).json({ 
        success: false, 
        message: "รหัสผ่านต้องมีความยาวไม่น้อยกว่า 8 ตัวอักษร" 
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ 
        success: false, 
        message: "รหัสผ่านยืนยันไม่ตรงกัน" 
      });
    }

    // 3. ตรวจสอบข้อมูลซ้ำในระบบ (Email และ Username)
    const existingEmail = await prisma.user.findUnique({
      where: { email }
    });
    if (existingEmail) {
      return res.status(400).json({ 
        success: false, 
        message: "อีเมลนี้ถูกใช้งานแล้ว" 
      });
    }

    const existingUsername = await prisma.user.findUnique({
      where: { username }
    });
    if (existingUsername) {
      return res.status(400).json({ 
        success: false, 
        message: "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว" 
      });
    }

    // 4. บันทึกลง Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username
        }
      }
    });

    if (authError || !authData.user) {
      return res.status(400).json({ 
        success: false, 
        message: authError?.message || "สมัครสมาชิกไม่สำเร็จ" 
      });
    }

    const authUser = authData.user;

    // 5. บันทึกลงฐานข้อมูล (Prisma) - กำหนดบทบาทเป็น MEMBER เริ่มต้นโดยอัตโนมัติ
    const dbUser = await prisma.user.create({
      data: {
        id: authUser.id,
        email,
        username,
        education_level,
        age: parseInt(age, 10),
        role: "MEMBER",
        status: "ACTIVE"
      }
    });

    return res.status(201).json({
      success: true,
      message: "สมัครสมาชิกสำเร็จ",
      data: dbUser
    });

  } catch (error) {
    console.error("Register user error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "เกิดข้อผิดพลาดในการลงทะเบียน" 
    });
  }
};

// ============================================================
// POST /api/v1/auth/login
// เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน
// ============================================================
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "กรุณากรอกอีเมลและรหัสผ่าน" 
      });
    }

    // 1. เข้าสู่ระบบผ่าน Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    // ตรวจสอบสิทธิ์ความปลอดภัย: กรณีผิดพลาดให้แจ้งเตือนความผิดพลาดในลักษณะทั่วไป
    if (error || !data.user || !data.session) {
      return res.status(400).json({ 
        success: false, 
        message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" 
      });
    }

    const authUser = data.user;

    // 2. ดึงข้อมูลสมาชิกจากฐานข้อมูล (Prisma)
    let dbUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      include: {
        unlocked_items: {
          include: { item: true }
        },
        user_milestones: {
          include: { milestone: true }
        }
      }
    });

    if (!dbUser) {
      // ป้องกันกรณี Supabase Auth มีผู้ใช้แต่ Prisma ยังไม่มี ให้สร้างขึ้นมาโดยอัตโนมัติ
      dbUser = await prisma.user.create({
        data: {
          id: authUser.id,
          email: authUser.email,
          username: authUser.email.split("@")[0],
          role: "MEMBER",
          status: "ACTIVE"
        },
        include: {
          unlocked_items: {
            include: { item: true }
          },
          user_milestones: {
            include: { milestone: true }
          }
        }
      });
    }

    // 3. ตรวจสอบสิทธิ์การถูกระงับการใช้งาน
    if (dbUser.status === "BANNED" || dbUser.status === "SUSPENDED") {
      return res.status(403).json({ 
        success: false, 
        message: "บัญชีของคุณถูกระงับการใช้งาน" 
      });
    }

    // แสดงข้อความต้อนรับ (Toast Message) และพาเข้าสู่ระบบ
    return res.status(200).json({
      success: true,
      message: "ยินดีต้อนรับเข้าสู่ระบบ",
      session: data.session,
      user: dbUser
    });

  } catch (error) {
    console.error("Login user error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" 
    });
  }
};

// ============================================================
// GET /api/v1/auth/me
// ตรวจสอบ token และ ดึงข้อมูลผู้ใช้งานปัจจุบัน (รองรับ Google OAuth)
// ============================================================
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

    // ดึงข้อมูลสมาชิกจากฐานข้อมูล (Prisma)
    let dbUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      include: {
        unlocked_items: {
          include: { item: true }
        },
        user_milestones: {
          include: { milestone: true }
        }
      }
    });

    const avatarUrl = authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || null;

    if (!dbUser) {
      // ตรวจสอบข้อมูลอีเมลหลัก (Auto-link: ผูกบัญชีอัตโนมัติหากมีอีเมลตรงกับบัญชีที่มีอยู่แล้ว)
      const existingUserByEmail = await prisma.user.findUnique({
        where: { email: authUser.email }
      });

      if (existingUserByEmail) {
        // อัปเดต primary key user_id ของบัญชีเดิมใน Prisma ให้ตรงกับ Supabase Google user ID
        // PostgreSQL จะอัปเดต cascade ไปยังตารางอื่นๆ ที่อ้างอิงอัตโนมัติ
        await prisma.$executeRawUnsafe(
          'UPDATE users SET user_id = $1 WHERE user_id = $2',
          authUser.id,
          existingUserByEmail.id
        );

        // ดึงข้อมูลสมาชิกที่ถูกผูกเรียบร้อยแล้ว
        dbUser = await prisma.user.findUnique({
          where: { id: authUser.id },
          include: {
            unlocked_items: {
              include: { item: true }
            },
            user_milestones: {
              include: { milestone: true }
            }
          }
        });

      } else {
        // กรณีเป็นสมาชิกใหม่ที่ไม่เคยมีอีเมลนี้ในระบบมาก่อน
        // ดึงรูปโปรไฟล์และตั้ง Nickname เริ่มต้นจากชื่อบัญชี Google
        let baseUsername = authUser.user_metadata?.full_name || authUser.email.split("@")[0];
        // แปลงเว้นวรรคให้เป็น underscore
        baseUsername = baseUsername.replace(/\s+/g, "_");
        
        let username = baseUsername;
        let counter = 1;

        // ตรวจสอบไม่ให้ Nickname ซ้ำในระบบ
        while (true) {
          const existingUsername = await prisma.user.findUnique({
            where: { username }
          });
          if (!existingUsername) break;
          username = `${baseUsername}${counter}`;
          counter++;
        }

        dbUser = await prisma.user.create({
          data: {
            id: authUser.id,
            email: authUser.email,
            username: username,
            profile_image: avatarUrl,
            role: "MEMBER",
            status: "ACTIVE"
          },
          include: {
            unlocked_items: {
              include: { item: true }
            },
            user_milestones: {
              include: { milestone: true }
            }
          }
        });
      }
    } else {
      // สมาชิกเดิม: อัปเดตโปรไฟล์ภาพถ่ายจาก Google หากในระบบยังไม่มี
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
            unlocked_items: {
              include: { item: true }
            },
            user_milestones: {
              include: { milestone: true }
            }
          }
        });
      }
    }

    // ตรวจสอบสิทธิ์การถูกระงับการใช้งาน
    if (dbUser.status === "BANNED" || dbUser.status === "SUSPENDED") {
      return res.status(403).json({ 
        message: "บัญชีของคุณถูกระงับการใช้งาน" 
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
    console.error("Verify user error:", error);
    res.status(500).json({
      message: "Server error"
    });
  }
};
