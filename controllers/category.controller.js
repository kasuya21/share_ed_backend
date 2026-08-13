import { prisma } from "../configs/prisma.js";

// ============================================================
// GET /api/v1/categories
// ดึงหมวดหมู่ทั้งหมด (Public)
// ============================================================
export const getAllCategories = async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: {
          select: { posts: true }
        }
      },
      orderBy: {
        name: "asc"
      }
    });

    res.status(200).json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error("Get all categories error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch categories" });
  }
};

// ============================================================
// POST /api/v1/admin/categories
// สร้างหมวดหมู่ใหม่ (Admin)
// ============================================================
export const createCategory = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({ success: false, message: "Category name is required" });
    }

    const trimmedName = name.trim();

    const existingCategory = await prisma.category.findUnique({
      where: { name: trimmedName }
    });

    if (existingCategory) {
      return res.status(400).json({ success: false, message: "Category already exists" });
    }

    const newCategory = await prisma.category.create({
      data: { name: trimmedName }
    });

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: newCategory
    });
  } catch (error) {
    console.error("Create category error:", error);
    res.status(500).json({ success: false, message: "Failed to create category" });
  }
};

// ============================================================
// PUT /api/v1/admin/categories/:id
// แก้ไขชื่อหมวดหมู่ (Admin)
// ============================================================
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({ success: false, message: "Category name is required" });
    }

    const trimmedName = name.trim();

    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const existingCategory = await prisma.category.findUnique({
      where: { name: trimmedName }
    });

    if (existingCategory && existingCategory.id !== id) {
      return res.status(400).json({ success: false, message: "Category name already taken" });
    }

    const updatedCategory = await prisma.category.update({
      where: { id },
      data: { name: trimmedName }
    });

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: updatedCategory
    });
  } catch (error) {
    console.error("Update category error:", error);
    res.status(500).json({ success: false, message: "Failed to update category" });
  }
};

// ============================================================
// DELETE /api/v1/admin/categories/:id
// ลบหมวดหมู่ (Admin) - อัปเดตโพสต์ที่ใช้ให้เป็น null
// ============================================================
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    // Unlink category from all posts that use it to prevent post deletion/errors
    await prisma.post.updateMany({
      where: { category_id: id },
      data: { category_id: null }
    });

    // Delete category
    await prisma.category.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: "Category deleted successfully"
    });
  } catch (error) {
    console.error("Delete category error:", error);
    res.status(500).json({ success: false, message: "Failed to delete category" });
  }
};
