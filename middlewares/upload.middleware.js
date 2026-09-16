import { logError } from "../utils/logger.js";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { isSupportedFile } from "../utils/upload-validation.js";

// Cloudinary configures itself automatically if CLOUDINARY_URL is present in the .env file.

// เก็บไฟล์ใน memory (buffer) แทนที่จะเขียนลง disk
// แล้วค่อยส่งต่อให้ Cloudinary
const storage = multer.memoryStorage();
const handleFile = storage._handleFile.bind(storage);
storage._handleFile = (req, file, cb) => handleFile(req, file, (error, result) => {
  if (error) return cb(error);
  if (!isSupportedFile(result.buffer)) return cb(Object.assign(new Error("Unsupported file content"), { code: "INVALID_UPLOAD" }));
  cb(null, result);
});

const fileFilter = (req, file, cb) => {
  // Multer reads the multipart Content-Disposition header filename as latin1.
  // Decode it to utf8 so Thai (and other non-ASCII) filenames are preserved correctly.
  file.originalname = Buffer.from(file.originalname, "latin1").toString("utf8");

  const allowed = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/pdf",
    "video/mp4",
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error("Unsupported file type"), { code: "INVALID_UPLOAD" }), false);
  }
};

export const upload = multer({
  storage,
  limits: {
    files: 16,
    fields: 30,
    parts: 46,
    fieldSize: 100 * 1024,
    fileSize: 25 * 1024 * 1024, // 25MB max
  },
  fileFilter,
});

export const uploadToCloudinary = (fileBuffer, folder = "share-ed", transformation = []) => {
  if (!isSupportedFile(fileBuffer)) {
    return Promise.reject(Object.assign(new Error("Unsupported file content"), { code: "INVALID_UPLOAD" }));
  }
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto", transformation, quality: "auto", fetch_format: "auto" },
      (error, result) => {
        if (error) {
          logError("middlewares.uploadToCloudinary", error);
          return reject(error);
        }
        resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
};
