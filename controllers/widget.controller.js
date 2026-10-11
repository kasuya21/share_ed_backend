import { prisma } from "../configs/prisma.js";
import { logError } from "../utils/logger.js";

const PLATFORM_DOMAINS = {
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  discord: ["discord.gg", "discord.com"],
  youtube: ["youtube.com", "youtu.be"],
};
const MAX_WIDGET_URL_LENGTH = 2048;

const validUrl = (platformId, value) => {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_WIDGET_URL_LENGTH || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !segments.length) return false;
    if (!PLATFORM_DOMAINS[platformId]?.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return false;
    if (platformId === "discord" && (hostname === "discord.com" || hostname.endsWith(".discord.com"))) {
      return segments[0] === "invite" && segments.length > 1;
    }
    if (platformId === "facebook" && segments[0] === "profile.php") return !!url.searchParams.get("id");
    if (platformId === "instagram" && ["p", "reel", "stories"].includes(segments[0])) {
      return segments.length > 1;
    }
    if (platformId === "youtube" && segments[0] === "watch") return !!url.searchParams.get("v");
    return true;
  } catch {
    return false;
  }
};

export const getMyWidgets = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { widgets: true } });
    if (!user) return res.status(404).json({ success: false, message: "ไม่พบบัญชีผู้ใช้" });
    // null distinguishes legacy accounts from users who intentionally removed every widget.
    return res.json({ success: true, data: Array.isArray(user.widgets) ? user.widgets : null });
  } catch (error) {
    logError("controllers.getMyWidgets", error, req);
    return res.status(500).json({ success: false, message: "โหลดวิดเจ็ตไม่สำเร็จ" });
  }
};

export const updateMyWidgets = async (req, res) => {
  const input = req.body?.widgets;
  if (!Array.isArray(input) || input.length > 4) {
    return res.status(400).json({ success: false, message: "ข้อมูลวิดเจ็ตไม่ถูกต้อง" });
  }

  const seen = new Set();
  const widgets = [];
  for (const widget of input) {
    const platformId = widget?.platformId;
    if (!Object.hasOwn(PLATFORM_DOMAINS, platformId) || seen.has(platformId) ||
        !validUrl(platformId, widget?.url) ||
        (widget.options !== undefined && (typeof widget.options !== "object" || widget.options === null || Array.isArray(widget.options) ||
          (widget.options.insideProfileCard !== undefined && typeof widget.options.insideProfileCard !== "boolean")))) {
      return res.status(400).json({ success: false, message: "ลิงก์หรือรูปแบบวิดเจ็ตไม่ถูกต้อง" });
    }
    seen.add(platformId);
    widgets.push({
      id: platformId,
      platformId,
      url: widget.url.trim(),
      options: { insideProfileCard: widget.options?.insideProfileCard !== false },
    });
  }

  try {
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { widgets }, select: { widgets: true } });
    return res.json({ success: true, data: user.widgets });
  } catch (error) {
    logError("controllers.updateMyWidgets", error, req);
    return res.status(500).json({ success: false, message: "บันทึกวิดเจ็ตไม่สำเร็จ" });
  }
};
