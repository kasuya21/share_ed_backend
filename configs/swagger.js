export const swaggerDocument = {
  "openapi": "3.0.0",
  "info": {
    "title": "ShareEd Backend API",
    "version": "1.0.0",
    "description": "Complete API documentation for ShareEd Backend. Built using Express and Prisma."
  },
  "servers": [
    {
      "url": "https://share-ed-backend-6jer.onrender.com/api/v1",
      "description": "🚀 Production Server (Render)"
    },
    {
      "url": "http://localhost:3000/api/v1",
      "description": "🖥️ Local Development Server"
    }
  ],
  "components": {
    "securitySchemes": {
      "BearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Enter your Supabase Access Token (JWT)"
      }
    },
    "schemas": {
      "User": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "description": "User ID synced from Supabase"
          },
          "email": {
            "type": "string",
            "format": "email"
          },
          "username": {
            "type": "string"
          },
          "profile_image": {
            "type": "string",
            "format": "uri",
            "nullable": true
          },
          "bio": {
            "type": "string",
            "nullable": true
          },
          "role": {
            "type": "string",
            "enum": [
              "MEMBER",
              "MODERATOR",
              "ADMIN"
            ]
          },
          "status": {
            "type": "string",
            "enum": [
              "ACTIVE",
              "SUSPENDED",
              "BANNED"
            ]
          },
          "education_level": {
            "type": "string",
            "enum": [
              "MIDDLE_SCHOOL",
              "HIGH_SCHOOL",
              "UNIVERSITY"
            ],
            "nullable": true
          },
          "nickname": {
            "type": "string",
            "nullable": true
          },
          "location": {
            "type": "string",
            "nullable": true
          },
          "occupation": {
            "type": "string",
            "nullable": true
          },
          "social_links": {
            "type": "object",
            "nullable": true
          },
          "wallpaper": {
            "type": "string",
            "nullable": true
          },
          "profile_banner": {
            "type": "string",
            "nullable": true
          },
          "is_onboarded": {
            "type": "boolean",
            "default": false
          },
          "current_theme_id": {
            "type": "string",
            "nullable": true
          },
          "current_frame_id": {
            "type": "string",
            "nullable": true
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Post": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "title": {
            "type": "string"
          },
          "summary": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "post_status": {
            "type": "string",
            "enum": [
              "DRAFT",
              "ACTIVE",
              "DELETED",
              "UNACTIVED"
            ]
          },
          "education_level": {
            "type": "string",
            "enum": [
              "MIDDLE_SCHOOL",
              "HIGH_SCHOOL",
              "UNIVERSITY"
            ]
          },
          "view_count": {
            "type": "integer"
          },
          "like_count": {
            "type": "integer"
          },
          "comment_count": {
            "type": "integer"
          },
          "bookmark_count": {
            "type": "integer"
          },
          "author_id": {
            "type": "string"
          },
          "category_id": {
            "type": "string",
            "nullable": true
          },
          "cover_image": {
            "type": "string",
            "nullable": true
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Comment": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "content": {
            "type": "string"
          },
          "user_id": {
            "type": "string"
          },
          "post_id": {
            "type": "string",
            "format": "uuid"
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Like": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "user_id": {
            "type": "string"
          },
          "post_id": {
            "type": "string",
            "format": "uuid"
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Bookmark": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "user_id": {
            "type": "string"
          },
          "post_id": {
            "type": "string",
            "format": "uuid"
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Notification": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "user_id": {
            "type": "string"
          },
          "type_id": {
            "type": "string",
            "format": "uuid"
          },
          "message": {
            "type": "string"
          },
          "is_read": {
            "type": "boolean",
            "default": false
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Report": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "reason": {
            "type": "string"
          },
          "user_id": {
            "type": "string"
          },
          "post_id": {
            "type": "string",
            "format": "uuid"
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "RewardItem": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "item_name": {
            "type": "string"
          },
          "item_type": {
            "type": "string",
            "enum": [
              "THEME",
              "FRAME"
            ]
          },
          "image_url": {
            "type": "string",
            "nullable": true
          },
          "metadata": {
            "type": "object",
            "nullable": true
          },
          "is_active": {
            "type": "boolean",
            "default": true
          }
        }
      },
      "Milestone": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "title": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "target_value": {
            "type": "integer"
          },
          "milestone_type": {
            "type": "string"
          },
          "reward_item_id": {
            "type": "string",
            "nullable": true
          }
        }
      },
      "UserMilestone": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "user_id": {
            "type": "string"
          },
          "milestone_id": {
            "type": "string"
          },
          "current_progress": {
            "type": "integer",
            "default": 0
          },
          "is_completed": {
            "type": "boolean",
            "default": false
          },
          "completed_at": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          },
          "claimed_at": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    }
  },
  "paths": {
    "/auth/register": {
      "post": {
        "summary": "Register new member",
        "description": "สมัครสมาชิกใหม่ด้วย Email + Password. ต้องส่งข้อมูลครบทุก field ที่กำหนด",
        "tags": [
          "🔐 Auth"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "password",
                  "confirmPassword",
                  "username",
                  "education_level"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email",
                    "example": "user@example.com"
                  },
                  "password": {
                    "type": "string",
                    "minLength": 8,
                    "example": "password123"
                  },
                  "confirmPassword": {
                    "type": "string",
                    "minLength": 8,
                    "example": "password123",
                    "description": "ต้องตรงกับ password"
                  },
                  "username": {
                    "type": "string",
                    "example": "myusername",
                    "description": "ชื่อผู้ใช้งานในระบบ"
                  },
                  "education_level": {
                    "type": "string",
                    "enum": [
                      "MIDDLE_SCHOOL",
                      "HIGH_SCHOOL",
                      "UNIVERSITY"
                    ],
                    "example": "HIGH_SCHOOL"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "สมัครสมาชิกสำเร็จ",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": { "type": "boolean", "example": true },
                    "message": { "type": "string", "example": "สมัครสมาชิกสำเร็จ" },
                    "data": { "$ref": "#/components/schemas/User" }
                  }
                }
              }
            }
          },
          "400": {
            "description": "ข้อมูลไม่ครบ / รหัสผ่านไม่ตรง / อีเมลหรือ nickname ซ้ำ",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": { "type": "boolean", "example": false },
                    "message": { "type": "string", "example": "กรุณาระบุข้อมูลให้ครบถ้วน" }
                  }
                }
              }
            }
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/auth/login": {
      "post": {
        "summary": "Login with Email & Password",
        "description": "เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน จะได้รับ session token สำหรับใช้เป็น Bearer token",
        "tags": [
          "🔐 Auth"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "password"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email",
                    "example": "user@example.com"
                  },
                  "password": {
                    "type": "string",
                    "example": "password123"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "เข้าสู่ระบบสำเร็จ",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": { "type": "boolean", "example": true },
                    "message": { "type": "string", "example": "ยินดีต้อนรับเข้าสู่ระบบ" },
                    "session": {
                      "type": "object",
                      "description": "Supabase session — ใช้ access_token เป็น Bearer token",
                      "properties": {
                        "access_token": { "type": "string" },
                        "token_type": { "type": "string", "example": "bearer" },
                        "expires_in": { "type": "integer" }
                      }
                    },
                    "user": { "$ref": "#/components/schemas/User" }
                  }
                }
              }
            }
          },
          "400": {
            "description": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": { "type": "boolean", "example": false },
                    "message": { "type": "string", "example": "อีเมลหรือรหัสผ่านไม่ถูกต้อง" }
                  }
                }
              }
            }
          },
          "403": {
            "description": "บัญชีถูกระงับ (BANNED / SUSPENDED)"
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/auth/me": {
      "get": {
        "summary": "Verify & Sync User",
        "description": "Verify the Supabase JWT token and sync the user profile into the local PostgreSQL database (auto-creates if it doesn't exist).",
        "tags": [
          "🔐 Auth"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Successfully verified and synced user.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/User"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized or invalid token."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/auth/change-password": {
      "put": {
        "summary": "Change User Password",
        "description": "เปลี่ยนรหัสผ่านของผู้ใช้ด้วย Token ปัจจุบัน",
        "tags": [
          "🔐 Auth"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "newPassword",
                  "confirmNewPassword"
                ],
                "properties": {
                  "newPassword": {
                    "type": "string",
                    "minLength": 8,
                    "example": "newpassword123"
                  },
                  "confirmNewPassword": {
                    "type": "string",
                    "minLength": 8,
                    "example": "newpassword123"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "เปลี่ยนรหัสผ่านสำเร็จ"
          },
          "400": {
            "description": "ข้อมูลไม่ถูกต้อง (รหัสผ่านไม่ตรงกัน หรือสั้นเกินไป)"
          },
          "401": {
            "description": "ไม่ได้ส่ง Token หรือ Token ไม่ถูกต้อง"
          },
          "500": {
            "description": "Server error"
          }
        }
      }
    },

    "/categories": {
      "get": {
        "summary": "Get All Categories",
        "description": "Retrieve a list of all available categories",
        "tags": ["🏷️ Categories"],
        "responses": {
          "200": {
            "description": "List of categories retrieved successfully."
          }
        }
      }
    },
    "/admin/categories": {
      "post": {
        "summary": "Create Category",
        "description": "Create a new category (Admin only)",
        "tags": ["🛡️ Admin"],
        "security": [{"BearerAuth": []}],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["name"],
                "properties": {
                  "name": { "type": "string", "example": "วิทยาศาสตร์" }
                }
              }
            }
          }
        },
        "responses": {
          "201": { "description": "Category created successfully" },
          "400": { "description": "Category name missing or already exists" },
          "500": { "description": "Server error" }
        }
      }
    },
    "/admin/categories/{id}": {
      "put": {
        "summary": "Update Category",
        "description": "Rename a category (Admin only)",
        "tags": ["🛡️ Admin"],
        "security": [{"BearerAuth": []}],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["name"],
                "properties": {
                  "name": { "type": "string", "example": "คณิตศาสตร์" }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "Category updated successfully" },
          "404": { "description": "Category not found" }
        }
      },
      "delete": {
        "summary": "Delete Category",
        "description": "Delete a category and unlink it from all associated posts (Admin only)",
        "tags": ["🛡️ Admin"],
        "security": [{"BearerAuth": []}],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "Category deleted successfully" },
          "404": { "description": "Category not found" }
        }
      }
    },
    "/posts": {
      "get": {
        "summary": "Get All Posts (Search & Filter)",
        "description": "Retrieve posts with optional filtering and sorting.",
        "tags": [
          "📝 Posts"
        ],
        "parameters": [
          {
            "name": "search",
            "in": "query",
            "description": "Keyword search in post title or content",
            "required": false,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "level",
            "in": "query",
            "description": "Education level filter",
            "required": false,
            "schema": {
              "type": "string",
              "enum": [
                "MIDDLE_SCHOOL",
                "HIGH_SCHOOL",
                "UNIVERSITY"
              ]
            }
          },
          {
            "name": "sort",
            "in": "query",
            "description": "Sort order",
            "required": false,
            "schema": {
              "type": "string",
              "enum": [
                "latest",
                "popular",
                "likes"
              ],
              "default": "latest"
            }
          },
          {
            "name": "category_id",
            "in": "query",
            "description": "Category ID filter",
            "required": false,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "List of posts matching filters.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Post"
                  }
                }
              }
            }
          },
          "500": {
            "description": "Server error."
          }
        }
      },
      "post": {
        "summary": "Create Post",
        "description": "Create a new post. Limited to 3 posts per 24 hours per user.",
        "tags": [
          "📝 Posts"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "required": [
                  "title",
                  "content",
                  "education_level"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "description": "หัวข้อโพสต์"
                  },
                  "summary": {
                    "type": "string",
                    "description": "สรุปโพสต์ (ถ้ามี)"
                  },
                  "content": {
                    "type": "string",
                    "description": "เนื้อหาโพสต์"
                  },
                  "education_level": {
                    "type": "string",
                    "enum": [
                      "MIDDLE_SCHOOL",
                      "HIGH_SCHOOL",
                      "UNIVERSITY"
                    ]
                  },
                  "post_status": {
                    "type": "string",
                    "enum": [
                      "DRAFT",
                      "ACTIVE"
                    ],
                    "default": "DRAFT"
                  },
                  "category_id": {
                    "type": "string",
                    "format": "uuid",
                    "nullable": true
                  },
                  "tags": {
                    "type": "string",
                    "description": "แท็กของโพสต์ (สามารถส่งเป็น JSON string array หรือ comma-separated string เช่น 'tag1, tag2')",
                    "example": "[\"คณิตศาสตร์\", \"สอบเข้า\"]"
                  },
                  "cover_image": {
                    "type": "string",
                    "format": "binary",
                    "description": "รูปภาพหน้าปก (ไฟล์เดียว)"
                  },
                  "media_files": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "binary"
                    },
                    "description": "ไฟล์แนบ (รูปภาพหรือ PDF, อัปโหลดได้สูงสุด 15 ไฟล์)"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Post created successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Post"
                }
              }
            }
          },
          "400": {
            "description": "Missing required fields."
          },
          "401": {
            "description": "Unauthorized."
          },
          "429": {
            "description": "Post limit reached (max 3 posts/24h)."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/posts/trending": {
      "get": {
        "summary": "Get Trending Posts",
        "description": "Retrieve posts trending in the last 7 days.",
        "tags": [
          "📝 Posts"
        ],
        "responses": {
          "200": {
            "description": "List of trending posts.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Post"
                  }
                }
              }
            }
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/posts/most-liked": {
      "get": {
        "summary": "Get Most Liked Posts",
        "description": "Retrieve most liked posts.",
        "tags": [
          "📝 Posts"
        ],
        "responses": {
          "200": {
            "description": "List of most liked posts.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Post"
                  }
                }
              }
            }
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/posts/user/my-posts": {
      "get": {
        "summary": "Get My Posts",
        "description": "Retrieve posts created by the currently authenticated user.",
        "tags": [
          "📝 Posts"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of user's posts.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Post"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/posts/{id}": {
      "get": {
        "summary": "Get Post by ID",
        "description": "Retrieve a specific post details by its ID.",
        "tags": [
          "📝 Posts"
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Post ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Post details.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Post"
                }
              }
            }
          },
          "404": {
            "description": "Post not found."
          },
          "500": {
            "description": "Server error."
          }
        }
      },
      "put": {
        "summary": "Update Post",
        "description": "Update the title or status of an existing post.",
        "tags": [
          "📝 Posts"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Post ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string",
                    "description": "หัวข้อโพสต์"
                  },
                  "summary": {
                    "type": "string",
                    "description": "สรุปโพสต์ (ถ้ามี)"
                  },
                  "content": {
                    "type": "string",
                    "description": "เนื้อหาโพสต์"
                  },
                  "education_level": {
                    "type": "string",
                    "enum": [
                      "MIDDLE_SCHOOL",
                      "HIGH_SCHOOL",
                      "UNIVERSITY"
                    ]
                  },
                  "post_status": {
                    "type": "string",
                    "enum": [
                      "DRAFT",
                      "ACTIVE",
                      "DELETED"
                    ]
                  },
                  "category_id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "tags": {
                    "type": "string",
                    "description": "แท็กของโพสต์ (JSON string array หรือ comma-separated)"
                  },
                  "remove_media_ids": {
                    "type": "string",
                    "description": "รายการ ID ของไฟล์แนบที่ต้องการลบ (JSON string array หรือ comma-separated)"
                  },
                  "cover_image": {
                    "type": "string",
                    "format": "binary",
                    "description": "รูปภาพหน้าปกใหม่ (ถ้าต้องการเปลี่ยน)"
                  },
                  "media_files": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "binary"
                    },
                    "description": "ไฟล์แนบเพิ่มเติม"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Post updated successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Post"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "404": {
            "description": "Post not found or not author."
          },
          "500": {
            "description": "Server error."
          }
        }
      },
      "delete": {
        "summary": "Soft Delete Post",
        "description": "Soft deletes a post by setting its status to ARCHIVED.",
        "tags": [
          "📝 Posts"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Post ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Post archived successfully."
          },
          "401": {
            "description": "Unauthorized."
          },
          "404": {
            "description": "Post not found or not author."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/comment/post/{postId}": {
      "get": {
        "summary": "Get Comments for Post",
        "description": "Retrieve all comments written under a specific post.",
        "tags": [
          "💬 Comments"
        ],
        "parameters": [
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "description": "Post ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "List of comments.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Comment"
                  }
                }
              }
            }
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/comment": {
      "post": {
        "summary": "Create Comment",
        "description": "Add a comment to a post. Sends a notification to the post owner.",
        "tags": [
          "💬 Comments"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "post_id",
                  "content"
                ],
                "properties": {
                  "post_id": {
                    "type": "string",
                    "description": "Post ID"
                  },
                  "content": {
                    "type": "string",
                    "description": "Comment content"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Comment created successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Comment"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "404": {
            "description": "Post not found."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/comment/{id}": {
      "put": {
        "summary": "Update Comment",
        "description": "Modify an existing comment content.",
        "tags": [
          "💬 Comments"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Comment ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "content"
                ],
                "properties": {
                  "content": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Comment updated successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Comment"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "404": {
            "description": "Comment not found or not owner."
          },
          "500": {
            "description": "Server error."
          }
        }
      },
      "delete": {
        "summary": "Delete Comment",
        "description": "Delete an existing comment.",
        "tags": [
          "💬 Comments"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Comment ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Comment deleted successfully."
          },
          "401": {
            "description": "Unauthorized."
          },
          "404": {
            "description": "Comment not found or not owner."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/likes/{postId}": {
      "get": {
        "summary": "Like Status",
        "description": "Checks if the current user has liked the post.",
        "tags": [
          "❤️ Likes"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "description": "Post ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Like status.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "liked": {
                      "type": "boolean"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      },
      "post": {
        "summary": "Toggle Like/Unlike",
        "description": "Like the post if not liked yet, or unlike if already liked.",
        "tags": [
          "❤️ Likes"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "description": "Post ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Toggled status.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "liked": {
                      "type": "boolean"
                    },
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/bookmarks": {
      "get": {
        "summary": "Get My Bookmarks",
        "description": "Retrieve all posts bookmarked by the user.",
        "tags": [
          "🔖 Bookmarks"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of bookmarks.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Bookmark"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/bookmarks/{postId}": {
      "post": {
        "summary": "Toggle Bookmark",
        "description": "Bookmark a post, or remove it from bookmarks if already bookmarked.",
        "tags": [
          "🔖 Bookmarks"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "description": "Post ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Toggled status.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "bookmarked": {
                      "type": "boolean"
                    },
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/follow/{userId}": {
      "post": {
        "summary": "Follow User",
        "description": "Follow another user.",
        "tags": [
          "👥 Follow"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "description": "User ID to follow",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Successfully followed."
          },
          "400": {
            "description": "Cannot follow yourself or already followed."
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      },
      "delete": {
        "summary": "Unfollow User",
        "description": "Unfollow another user.",
        "tags": [
          "👥 Follow"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "description": "User ID to unfollow",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Successfully unfollowed."
          },
          "400": {
            "description": "Not following this user."
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/follow/{userId}/followers": {
      "get": {
        "summary": "Get Followers",
        "description": "Retrieve followers list of a user.",
        "tags": [
          "👥 Follow"
        ],
        "parameters": [
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "description": "User ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "List of followers.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "follower": {
                        "$ref": "#/components/schemas/User"
                      }
                    }
                  }
                }
              }
            }
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/follow/{userId}/following": {
      "get": {
        "summary": "Get Following",
        "description": "Retrieve users that a specific user follows.",
        "tags": [
          "👥 Follow"
        ],
        "parameters": [
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "description": "User ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "List of following.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "following": {
                        "$ref": "#/components/schemas/User"
                      }
                    }
                  }
                }
              }
            }
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/notifications": {
      "get": {
        "summary": "Get My Notifications",
        "description": "Retrieve notifications list of the authenticated user.",
        "tags": [
          "🔔 Notifications"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of notifications.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Notification"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/notifications/read-all": {
      "patch": {
        "summary": "Mark All as Read",
        "description": "Mark all user notifications as read.",
        "tags": [
          "🔔 Notifications"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "All notifications marked as read."
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/notifications/{id}/read": {
      "patch": {
        "summary": "Mark One as Read",
        "description": "Mark a single notification as read.",
        "tags": [
          "🔔 Notifications"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Notification ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Notification marked as read."
          },
          "401": {
            "description": "Unauthorized."
          },
          "404": {
            "description": "Notification not found or not owner."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/notifications/{id}": {
      "delete": {
        "summary": "Delete Notification",
        "description": "Delete a notification.",
        "tags": [
          "🔔 Notifications"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Notification ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Notification deleted."
          },
          "401": {
            "description": "Unauthorized."
          },
          "404": {
            "description": "Notification not found or not owner."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/reports": {
      "post": {
        "summary": "Report a Post",
        "description": "Report a post. Limit: 1 report per user per post. If a post gets 10 reports, it will be automatically deactivated (UNACTIVED).",
        "tags": [
          "🚨 Reports"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "post_id",
                  "reason"
                ],
                "properties": {
                  "post_id": {
                    "type": "string",
                    "description": "Post ID"
                  },
                  "reason": {
                    "type": "string",
                    "description": "Reason for reporting"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Report created successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Report"
                }
              }
            }
          },
          "400": {
            "description": "Already reported or invalid data."
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/reports/my": {
      "get": {
        "summary": "Get My Reports",
        "description": "Get list of reports submitted by the logged-in user.",
        "tags": [
          "🚨 Reports"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of reports.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Report"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/moderator/reports": {
      "get": {
        "summary": "Get Reported Posts",
        "description": "Retrieve all posts that have been reported. Access restricted to MODERATOR and ADMIN roles.",
        "tags": [
          "🛡️ Moderator"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of reports and reported posts.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "reason": {
                        "type": "string"
                      },
                      "post": {
                        "$ref": "#/components/schemas/Post"
                      },
                      "user": {
                        "$ref": "#/components/schemas/User"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "403": {
            "description": "Forbidden - Role must be MODERATOR or ADMIN."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/moderator/posts/{id}/action": {
      "post": {
        "summary": "Perform Action on Reported Post",
        "description": "Perform moderation actions: RESTORE (re-activates post) or SOFT_DELETE (archives post).",
        "tags": [
          "🛡️ Moderator"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Post ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "action"
                ],
                "properties": {
                  "action": {
                    "type": "string",
                    "enum": [
                      "RESTORE",
                      "SOFT_DELETE"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Action performed successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "message": {
                      "type": "string"
                    },
                    "post": {
                      "$ref": "#/components/schemas/Post"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid action."
          },
          "401": {
            "description": "Unauthorized."
          },
          "403": {
            "description": "Forbidden."
          },
          "404": {
            "description": "Post not found."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/admin/users": {
      "get": {
        "summary": "Get All Users",
        "description": "Retrieve all registered users. Role required: ADMIN.",
        "tags": [
          "⚙️ Admin"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of users.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/User"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized."
          },
          "403": {
            "description": "Forbidden."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/admin/users/{id}/role": {
      "patch": {
        "summary": "Change User Role",
        "description": "Change user role to MEMBER, MODERATOR, or ADMIN. Role required: ADMIN.",
        "tags": [
          "⚙️ Admin"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "User ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "enum": [
                      "MEMBER",
                      "MODERATOR",
                      "ADMIN"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "User role updated successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/User"
                }
              }
            }
          },
          "400": {
            "description": "Invalid role."
          },
          "401": {
            "description": "Unauthorized."
          },
          "403": {
            "description": "Forbidden."
          },
          "404": {
            "description": "User not found."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/admin/users/{id}/ban": {
      "patch": {
        "summary": "Ban User",
        "description": "Ban a user account by setting status to BANNED. Cannot ban an ADMIN account. Role required: ADMIN.",
        "tags": [
          "⚙️ Admin"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "User ID to ban",
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "reason": {
                    "type": "string",
                    "description": "Optional reason for the ban"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "User banned successfully."
          },
          "400": {
            "description": "User is already banned or cannot ban admin."
          },
          "401": {
            "description": "Unauthorized."
          },
          "403": {
            "description": "Forbidden."
          },
          "404": {
            "description": "User not found."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/admin/users/{id}/unban": {
      "patch": {
        "summary": "Unban User",
        "description": "Restore a banned user account to ACTIVE status. Role required: ADMIN.",
        "tags": [
          "⚙️ Admin"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "User ID to unban",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "User unbanned successfully."
          },
          "400": {
            "description": "User is not currently banned."
          },
          "401": {
            "description": "Unauthorized."
          },
          "403": {
            "description": "Forbidden."
          },
          "404": {
            "description": "User not found."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/users/{id}": {
      "get": {
        "summary": "Get Public Profile",
        "description": "Retrieve public profile information of a user.",
        "tags": [
          "👤 Users"
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "User ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "User profile details.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/User"
                }
              }
            }
          },
          "404": {
            "description": "User not found."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/users/profile": {
      "put": {
        "summary": "Update My Profile",
        "description": "Update the authenticated user's profile detail.",
        "tags": [
          "👤 Users"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "username": {
                    "type": "string"
                  },
                  "bio": {
                    "type": "string"
                  },
                  "education_level": {
                    "type": "string",
                    "enum": [
                      "MIDDLE_SCHOOL",
                      "HIGH_SCHOOL",
                      "UNIVERSITY"
                    ]
                  },
                  "nickname": {
                    "type": "string"
                  },
                  "location": {
                    "type": "string"
                  },
                  "occupation": {
                    "type": "string"
                  },
                  "social_links": {
                    "type": "string",
                    "description": "JSON string of social links (e.g. {\"facebook\":\"url\"})"
                  },
                  "profile_image": {
                    "type": "string",
                    "format": "binary"
                  },
                  "wallpaper": {
                    "type": "string",
                    "format": "binary"
                  },
                  "profile_banner": {
                    "type": "string",
                    "format": "binary"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Profile updated successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/User"
                }
              }
            }
          },
          "400": {
            "description": "Username already taken."
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/users/profile/with-media": {
      "put": {
        "summary": "Update Profile with Media (Frontend Compatible)",
        "description": "อัปเดตโปรไฟล์พร้อมรองรับการอัปโหลด Avatar, Banner และ Wallpaper ผ่าน multipart/form-data รวมถึงรับ Social Links (Facebook, Instagram, Discord) ใน Body",
        "tags": [
          "👤 Users"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "username": {
                    "type": "string"
                  },
                  "nickname": {
                    "type": "string"
                  },
                  "bio": {
                    "type": "string"
                  },
                  "education_level": {
                    "type": "string",
                    "enum": [
                      "MIDDLE_SCHOOL",
                      "HIGH_SCHOOL",
                      "UNIVERSITY"
                    ]
                  },
                  "location": {
                    "type": "string"
                  },
                  "occupation": {
                    "type": "string"
                  },
                  "facebook_url": {
                    "type": "string"
                  },
                  "instagram_url": {
                    "type": "string"
                  },
                  "discord_url": {
                    "type": "string"
                  },
                  "avatar": {
                    "type": "string",
                    "format": "binary"
                  },
                  "banner": {
                    "type": "string",
                    "format": "binary"
                  },
                  "wallpaper": {
                    "type": "string",
                    "format": "binary"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Profile updated successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/User"
                }
              }
            }
          },
          "400": {
            "description": "Username already taken."
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/users/onboard": {
      "put": {
        "summary": "Onboard User Profile",
        "description": "กรอกข้อมูลโปรไฟล์ครั้งแรกหลังจากสมัครสมาชิก",
        "tags": [
          "👤 Users"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "username"
                ],
                "properties": {
                  "username": {
                    "type": "string"
                  },
                  "bio": {
                    "type": "string"
                  },
                  "education_level": {
                    "type": "string",
                    "enum": [
                      "MIDDLE_SCHOOL",
                      "HIGH_SCHOOL",
                      "UNIVERSITY"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Profile onboarded successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/User"
                }
              }
            }
          },
          "400": {
            "description": "Username already taken."
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/users/equip": {
      "put": {
        "summary": "Equip Theme or Frame",
        "description": "Equip a purchased theme or frame item. Set itemId to null to unequip.",
        "tags": [
          "👤 Users"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "type"
                ],
                "properties": {
                  "itemId": {
                    "type": "string",
                    "nullable": true,
                    "description": "Shop item ID"
                  },
                  "type": {
                    "type": "string",
                    "enum": [
                      "THEME",
                      "FRAME"
                    ],
                    "description": "Type of item"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Item equipped successfully.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/User"
                }
              }
            }
          },
          "400": {
            "description": "Invalid request or item not owned."
          },
          "401": {
            "description": "Unauthorized."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/milestones": {
      "get": {
        "summary": "Get Milestones",
        "description": "Retrieve milestones and user progress.",
        "tags": [
          "🏆 Milestones"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of milestones with user progress.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Milestone"
                  }
                }
              }
            }
          }
        }
      }
    },
    "/milestones/{id}/claim": {
      "post": {
        "summary": "Claim Milestone Reward",
        "description": "Claim the reward item for a completed milestone.",
        "tags": [
          "🏆 Milestones"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Milestone ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Reward claimed successfully."
          },
          "400": {
            "description": "Milestone not completed or already claimed."
          }
        }
      }
    },
    "/admin/milestones": {
      "get": {
        "summary": "Get All Milestones (Admin)",
        "description": "Retrieve all milestones for admin management.",
        "tags": [
          "🛠️ Admin"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of all milestones."
          },
          "500": {
            "description": "Server error."
          }
        }
      },
      "post": {
        "summary": "Create Milestone (Admin)",
        "description": "Create a new milestone.",
        "tags": [
          "🛠️ Admin"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": { "type": "string" },
                  "description": { "type": "string" },
                  "target_value": { "type": "integer" },
                  "milestone_type": { "type": "string" },
                  "reward_item_id": { "type": "string" },
                  "item_name": { "type": "string" },
                  "item_type": { "type": "string", "enum": ["THEME", "FRAME"] },
                  "item_description": { "type": "string" },
                  "is_active": { "type": "boolean" },
                  "image": { "type": "string", "format": "binary" }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Milestone created successfully."
          },
          "400": {
            "description": "Missing required fields."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    },
    "/admin/milestones/{id}": {
      "put": {
        "summary": "Update Milestone (Admin)",
        "description": "Update an existing milestone.",
        "tags": [
          "🛠️ Admin"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Milestone ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": { "type": "string" },
                  "description": { "type": "string" },
                  "target_value": { "type": "integer" },
                  "milestone_type": { "type": "string" },
                  "reward_item_id": { "type": "string" },
                  "item_name": { "type": "string" },
                  "item_type": { "type": "string", "enum": ["THEME", "FRAME"] },
                  "item_description": { "type": "string" },
                  "is_active": { "type": "boolean" },
                  "image": { "type": "string", "format": "binary" }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Milestone updated successfully."
          },
          "404": {
            "description": "Milestone not found."
          },
          "500": {
            "description": "Server error."
          }
        }
      },
      "delete": {
        "summary": "Delete Milestone (Admin)",
        "description": "Delete a milestone.",
        "tags": [
          "🛠️ Admin"
        ],
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Milestone ID",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Milestone deleted successfully."
          },
          "400": {
            "description": "Cannot delete milestone, users have progress on it."
          },
          "404": {
            "description": "Milestone not found."
          },
          "500": {
            "description": "Server error."
          }
        }
      }
    }
  }
};
