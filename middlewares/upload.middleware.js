import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

// Cloudinary configures itself automatically if CLOUDINARY_URL is present in the .env file.

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/") || file.mimetype === "video/mp4") {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only images and mp4 videos are allowed."), false);
  }
};

export const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max to support wallpaper videos
  },
  fileFilter,
});

export const uploadToCloudinary = (fileBuffer, folder = "share-ed") => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto" },
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          return reject(error);
        }
        resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
};
