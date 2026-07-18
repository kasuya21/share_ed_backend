import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

// Cloudinary configures itself automatically if CLOUDINARY_URL is present in the .env file.

// เก็บไฟล์ใน memory (buffer) แทนที่จะเขียนลง disk
// แล้วค่อยส่งต่อให้ Cloudinary
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/pdf",
    "video/mp4",
  ];
  if (allowed.includes(file.mimetype) || file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only images, mp4 videos, and PDF files are allowed"), false);
  }
};

export const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max
  },
  fileFilter,
});

export const uploadToCloudinary = (fileBuffer, folder = "share-ed", transformation = []) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto", transformation, quality: "auto", fetch_format: "auto" },
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
