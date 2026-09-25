import { logError, logWarn } from "../utils/logger.js";
import { validatePassword } from "../utils/password-validation.js";
import { bearerToken } from "../utils/security.js";
import { supabase } from "../configs/supabase.config.js";
import { prisma } from "../configs/prisma.js";

const EMAIL_VERIFICATION_MESSAGE = "หากอีเมลนี้รอการยืนยัน ระบบจะส่งรหัสยืนยันให้คุณ";

function verificationRedirectUrl() {
  const configured = process.env.EMAIL_VERIFICATION_REDIRECT_URL?.trim();
  return configured || "https://share-ed.online/verify-email";
}

// ============================================================
// POST /api/v1/auth/register
// สมัครสมาชิกใหม่ (Guest -> Member)
// ============================================================
export const registerUser = async (req, res) => {
  try {
    const { email, password, confirmPassword, username, education_level } = req.body || {};
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedUsername = typeof username === "string" ? username.trim() : "";
    if (typeof email !== "string" || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      || typeof username !== "string" || !normalizedUsername || normalizedUsername.length > 100
      || !["MIDDLE_SCHOOL", "HIGH_SCHOOL", "UNIVERSITY"].includes(education_level)) {
      return res.status(400).json({ success: false, message: "Invalid registration fields" });
    }

    // 1. ตรวจสอบข้อมูลบังคับกรอก (Mandatory Fields)
    if (!email || !password || !confirmPassword || !username || !education_level) {
      return res.status(400).json({ 
        success: false, 
        message: "กรุณาระบุข้อมูลให้ครบถ้วน" 
      });
    }

    // 2. ความปลอดภัยของรหัสผ่าน
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length) {
      return res.status(400).json({
        success: false,
        message: passwordErrors.map(error => error.message).join("; "),
        errors: { password: passwordErrors },
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
      where: { email: normalizedEmail }
    });
    if (existingEmail) {
      return res.status(400).json({ 
        success: false, 
        message: "อีเมลนี้ถูกใช้งานแล้ว" 
      });
    }

    const existingUsername = await prisma.user.findUnique({
      where: { username: normalizedUsername }
    });
    if (existingUsername) {
      return res.status(400).json({ 
        success: false, 
        message: "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว" 
      });
    }

    // 4. บันทึกลง Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          username: normalizedUsername,
          education_level,
        },
        emailRedirectTo: verificationRedirectUrl(),
      }
    });

    if (authError || !authData.user) {
      logWarn("auth.register.provider_rejected", authError, req);
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
        email: normalizedEmail,
        username: normalizedUsername,
        education_level,
        role: "MEMBER",
        status: "ACTIVE"
      }
    });

    return res.status(201).json({
      success: true,
      code: authData.session ? "REGISTERED" : "EMAIL_VERIFICATION_REQUIRED",
      message: authData.session ? "สมัครสมาชิกสำเร็จ" : "สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมล",
      requires_email_verification: !authData.session,
      data: dbUser,
    });

  } catch (error) {
    logError("controllers.registerUser", error, req);
    return res.status(500).json({ 
      success: false, 
      message: "เกิดข้อผิดพลาดในการลงทะเบียน" 
    });
  }
};

// ============================================================
// POST /api/v1/auth/resend-verification
// ส่ง OTP ยืนยันอีเมลซ้ำ โดยตอบข้อความทั่วไปเพื่อไม่เปิดเผยบัญชีในระบบ
// ============================================================
export const resendVerificationEmail = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";

    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_EMAIL",
        message: "รูปแบบอีเมลไม่ถูกต้อง",
      });
    }

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: verificationRedirectUrl() },
    });

    if (error) {
      logWarn("auth.verification_resend.provider_rejected", error, req);
      if (error.status === 429 || /rate|seconds/i.test(error.message || "")) {
        return res.status(429).json({
          success: false,
          code: "VERIFICATION_RATE_LIMITED",
          message: "กรุณารอสักครู่ก่อนขอรหัสยืนยันใหม่",
        });
      }

      // Supabase may reject unknown/already-confirmed addresses. Keep the
      // response indistinguishable so this endpoint cannot enumerate users.
    }

    return res.status(200).json({
      success: true,
      code: "VERIFICATION_EMAIL_ACCEPTED",
      message: EMAIL_VERIFICATION_MESSAGE,
    });
  } catch (error) {
    logError("controllers.resendVerificationEmail", error, req);
    return res.status(500).json({
      success: false,
      code: "EMAIL_DELIVERY_FAILED",
      message: "ไม่สามารถส่งรหัสยืนยันได้ กรุณาลองใหม่ภายหลัง",
    });
  }
};

// ============================================================
// POST /api/v1/auth/login
// เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน
// ============================================================
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== "string" || typeof password !== "string" || !email || !password || email.length > 254 || password.length > 128) {
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
      logWarn("auth.login.provider_rejected", error, req);
      if (/email not confirmed/i.test(error?.message || "")) {
        return res.status(403).json({
          success: false,
          code: "EMAIL_NOT_VERIFIED",
          message: "กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ",
        });
      }
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
        current_frame: true,
        unlocked_items: {
          include: { item: true }
        },
        user_achievements: {
          include: { achievement: true }
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
          current_frame: true,
          unlocked_items: {
            include: { item: true }
          },
          user_achievements: {
            include: { achievement: true }
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
    logError("controllers.loginUser", error, req);
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
    // provisioningAuthMiddleware already verified the Supabase JWT signature.
    // Reuse its claims instead of calling Supabase Auth a second time.
    const authUser = req.user;
    if (!authUser?.id) return res.status(401).json({ message: "Invalid token" });

    // ดึงข้อมูลสมาชิกจากฐานข้อมูล (Prisma)
    let dbUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      include: {
        current_frame: true,
        unlocked_items: {
          include: { item: true }
        },
        user_achievements: {
          include: { achievement: true }
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
        return res.status(409).json({ message: "Account linking requires verification through the identity provider" });
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
            current_frame: true,
            unlocked_items: {
              include: { item: true }
            },
            user_achievements: {
              include: { achievement: true }
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
            current_frame: true,
            unlocked_items: {
              include: { item: true }
            },
            user_achievements: {
              include: { achievement: true }
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
    logError("controllers.verifyUser", error, req);
    res.status(500).json({
      message: "Server error"
    });
  }
};

// ============================================================
// PUT /api/v1/auth/change-password
// เปลี่ยนรหัสผ่าน (ใช้ Token ปัจจุบัน)
// ============================================================
export const changePassword = async (req, res) => {
  try {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const { newPassword, confirmNewPassword } = req.body || {};

    if (!newPassword || !confirmNewPassword) {
      return res.status(400).json({ success: false, message: "กรุณากรอกรหัสผ่านใหม่และการยืนยัน" });
    }

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length) {
      return res.status(400).json({
        success: false,
        message: passwordErrors.map(error => error.message).join("; "),
        errors: { newPassword: passwordErrors },
      });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ success: false, message: "รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน" });
    }

    // สร้าง Client ชั่วคราวโดยแนบ Token ของ User ไปด้วย
    const { createClient } = await import("@supabase/supabase-js");
    const userSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const { data, error } = await userSupabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      logWarn("auth.change_password.provider_rejected", error, req);
      return res.status(400).json({ success: false, message: error.message || "เปลี่ยนรหัสผ่านไม่สำเร็จ" });
    }

    return res.status(200).json({ success: true, message: "เปลี่ยนรหัสผ่านสำเร็จ" });

  } catch (error) {
    logError("controllers.changePassword", error, req);
    return res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน" });
  }
};

// ============================================================
// POST /api/v1/auth/logout
// ออกจากระบบ
// ============================================================
export const logoutUser = async (req, res) => {
  try {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const { createClient } = await import("@supabase/supabase-js");
    const userSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const { error } = await userSupabase.auth.signOut();

    if (error) {
      logWarn("auth.logout.provider_rejected", error, req);
      return res.status(400).json({ success: false, message: error.message || "ออกจากระบบไม่สำเร็จ" });
    }

    return res.status(200).json({ success: true, message: "ออกจากระบบสำเร็จ" });

  } catch (error) {
    logError("controllers.logoutUser", error, req);
    return res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการออกจากระบบ" });
  }
};
