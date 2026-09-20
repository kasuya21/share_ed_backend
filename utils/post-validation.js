const EDUCATION_LEVELS = ["MIDDLE_SCHOOL", "HIGH_SCHOOL", "UNIVERSITY"];
export const POST_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
export const POST_MEDIA_TYPES = [...POST_IMAGE_TYPES, "application/pdf"];

function parseJson(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

export function validateNewPost(body, files) {
  const isDraft = body?.post_status === "DRAFT";
  const result = isDraft
    ? {
        errors: {},
        values: {
          title: typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "Untitled draft",
          summary: typeof body?.summary === "string" ? body.summary.trim() : "",
          education_level: EDUCATION_LEVELS.includes(body?.education_level) ? body.education_level : "UNIVERSITY",
        },
        valid: true,
      }
    : validatePostFields(body);
  const category = body?.category_id;
  const categoryName = body?.category;
  if (category !== undefined && category !== null && typeof category !== "string") {
    result.errors.category_id = { code: "INVALID_TYPE", message: "รหัสหมวดหมู่วิชาต้องเป็นข้อความ" };
  } else if (typeof category === "string" && category.trim()) {
    result.values.category_id = category.trim();
  } else if (typeof categoryName === "string" && categoryName.trim()) {
    // The frontend sends a name when it cannot resolve a category UUID.
    result.values.category = categoryName.trim();
  } else if (!isDraft) {
    result.errors.category_id = { code: "REQUIRED", message: "กรุณาเลือกหมวดหมู่วิชา" };
  }
  const hasCoverFile = Boolean(files?.cover_image?.length);
  const directCover = parseJson(body?.cover_upload);
  const hasDirectCover = Boolean(directCover && typeof directCover === "object" && !Array.isArray(directCover));

  if (!isDraft && !hasCoverFile && !hasDirectCover) {
    result.errors.cover_image = { code: "REQUIRED", message: "กรุณาอัปโหลดรูปปก" };
  } else if (hasCoverFile && (files.cover_image.length !== 1 || !POST_IMAGE_TYPES.includes(files.cover_image[0].mimetype))) {
    result.errors.cover_image = { code: "INVALID_TYPE", message: "รูปปกต้องเป็นรูปภาพ JPG, PNG หรือ WebP จำนวน 1 ไฟล์" };
  }

  const hasMediaFiles = Boolean(files?.media_files?.length);
  const directMedia = parseJson(body?.media_uploads);
  const hasDirectMedia = Array.isArray(directMedia) && directMedia.length > 0;

  if (!isDraft && !hasMediaFiles && !hasDirectMedia) {
    result.errors.media_files = { code: "REQUIRED", message: "กรุณาแนบไฟล์ PDF หรือรูปภาพอย่างน้อย 1 ไฟล์" };
  } else if (hasMediaFiles && files.media_files.some(file => !POST_MEDIA_TYPES.includes(file.mimetype))) {
    result.errors.media_files = { code: "INVALID_TYPE", message: "ไฟล์แนบต้องเป็น PDF หรือรูปภาพ JPG, PNG, WebP เท่านั้น" };
  }
  result.valid = Object.keys(result.errors).length === 0;
  return result;
}

export function validatePostFields(body, { partial = false } = {}) {
  const errors = {};
  const values = {};
  for (const [field, label] of Object.entries({ title: "หัวข้อสรุป", summary: "บทสรุปคัดย่อ", education_level: "ระดับชั้นการศึกษา" })) {
    const value = body?.[field];
    if (partial && value === undefined) continue;
    if (value === undefined || value === null) {
      errors[field] = { code: "REQUIRED", message: `กรุณาระบุ${label}` };
    } else if (typeof value !== "string") {
      errors[field] = { code: "INVALID_TYPE", message: `${label}ต้องเป็นข้อความ` };
    } else if (!value.trim()) {
      errors[field] = { code: "REQUIRED", message: `${label}ต้องไม่เป็นค่าว่างหรือมีเฉพาะช่องว่าง` };
    } else {
      values[field] = value.trim();
    }
  }
  if (values.education_level && !EDUCATION_LEVELS.includes(values.education_level)) {
    errors.education_level = { code: "INVALID_VALUE", message: "ระดับชั้นการศึกษาต้องเป็น MIDDLE_SCHOOL, HIGH_SCHOOL หรือ UNIVERSITY", allowed_values: [...EDUCATION_LEVELS] };
  }
  return { errors, values, valid: Object.keys(errors).length === 0 };
}
