import cloudinary from "../configs/cloudinary.config.js";
import { logError } from "./logger.js";

export const extractPublicId = (url, resourceType = 'image') => {
  try {
    const parsed = new URL(url);
    const prefix = `/${process.env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload/`;
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com' || !parsed.pathname.startsWith(prefix)) {
      return null;
    }
    const path = decodeURIComponent(parsed.pathname.slice(prefix.length)).replace(/^v\d+\//, '');
    if (!path) return null;
    // Cloudinary raw public IDs include their extension (for example .pdf).
    return resourceType === 'raw' ? path : path.replace(/\.[^/.]+$/, '');
  } catch {
    return null;
  }
};

export const deleteFromCloudinary = async (url, resourceType = 'image') => {
  const publicId = extractPublicId(url, resourceType);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    logError("cloudinary.delete_failed", error, undefined, { resourceType });
  }
};
