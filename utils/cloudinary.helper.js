import cloudinary from "../configs/cloudinary.config.js";

export const extractPublicId = (url) => {
  if (!url) return null;
  const parts = url.split('/upload/');
  if (parts.length < 2) return null;
  let path = parts[1];
  if (path.match(/^v\d+\//)) {
    path = path.replace(/^v\d+\//, '');
  }
  const lastDot = path.lastIndexOf('.');
  if (lastDot !== -1) {
    path = path.substring(0, lastDot);
  }
  return path;
};

export const deleteFromCloudinary = async (url, resourceType = 'image') => {
  const publicId = extractPublicId(url);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.error(`Failed to delete ${url} from Cloudinary:`, error.message);
  }
};
