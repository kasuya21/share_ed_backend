export const swaggerDocument = {
  openapi: "3.0.0",
  info: {
    title: "ShareEd Backend API",
    version: "1.0.0",
    description: "Complete API documentation for ShareEd Backend. Built using Express and Prisma.",
  },
  servers: [
    {
      url: "https://share-ed-backend-6jer.onrender.com/api/v1",
      description: "deploy server",
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Enter your Supabase Access Token (JWT)",
      },
    },
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "string", description: "User ID synced from Supabase" },
          email: { type: "string", format: "email" },
          username: { type: "string" },
          profile_image: { type: "string", format: "uri", nullable: true },
          bio: { type: "string", nullable: true },
          role: { type: "string", enum: ["MEMBER", "MODERATOR", "ADMIN"] },
          status: { type: "string", enum: ["ACTIVE", "SUSPENDED", "BANNED"] },
          education_level: { type: "string", enum: ["MIDDLE_SCHOOL", "HIGH_SCHOOL", "UNIVERSITY"], nullable: true },
          coin_balance: { type: "integer", default: 0 },
          current_theme_id: { type: "string", nullable: true },
          current_frame_id: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      Post: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          summary: { type: "string" },
          content: { type: "string" },
          post_status: { type: "string", enum: ["DRAFT", "PUBLISHED", "ARCHIVED", "UNACTIVED"] },
          view_count: { type: "integer" },
          education_level: { type: "string", enum: ["MIDDLE_SCHOOL", "HIGH_SCHOOL", "UNIVERSITY"] },
          author_id: { type: "string" },
          category_id: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Comment: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          content: { type: "string" },
          user_id: { type: "string" },
          post_id: { type: "string", format: "uuid" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      Like: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          user_id: { type: "string" },
          post_id: { type: "string", format: "uuid" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Bookmark: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          user_id: { type: "string" },
          post_id: { type: "string", format: "uuid" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Notification: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          user_id: { type: "string" },
          type_id: { type: "string", format: "uuid" },
          message: { type: "string" },
          is_read: { type: "boolean", default: false },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Report: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          reason: { type: "string" },
          user_id: { type: "string" },
          post_id: { type: "string", format: "uuid" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      ShopItem: {
        type: "object",
        properties: {
          id: { type: "string" },
          item_name: { type: "string" },
          item_type: { type: "string", enum: ["THEME", "FRAME"] },
          price: { type: "integer" },
          image_url: { type: "string", format: "uri", nullable: true },
          is_active: { type: "boolean", default: true },
        },
      },
      Purchase: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          user_id: { type: "string" },
          item_id: { type: "string" },
          purchased_at: { type: "string", format: "date-time" },
        },
      },
      Quest: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          quest_name: { type: "string" },
          quest_type: { type: "string" },
          target_value: { type: "integer" },
          reward_coin: { type: "integer" },
          is_daily: { type: "boolean", default: false },
        },
      },
      UserQuest: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          user_id: { type: "string" },
          quest_id: { type: "string", format: "uuid" },
          current_progress: { type: "integer", default: 0 },
          completed_at: { type: "string", format: "date-time", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
    },
  },
  paths: {
    "/auth/me": {
      get: {
        summary: "Verify & Sync User",
        description: "Verify the Supabase JWT token and sync the user profile into the local PostgreSQL database (auto-creates if it doesn't exist).",
        tags: ["🔐 Auth"],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "Successfully verified and synced user.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          401: { description: "Unauthorized or invalid token." },
          500: { description: "Server error." },
        },
      },
    },
    "/posts": {
      get: {
        summary: "Get All Posts (Search & Filter)",
        description: "Retrieve posts with optional filtering and sorting.",
        tags: ["📝 Posts"],
        parameters: [
          {
            name: "search",
            in: "query",
            description: "Keyword search in post title or content",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "level",
            in: "query",
            description: "Education level filter",
            required: false,
            schema: { type: "string", enum: ["MIDDLE_SCHOOL", "HIGH_SCHOOL", "UNIVERSITY"] },
          },
          {
            name: "sort",
            in: "query",
            description: "Sort order",
            required: false,
            schema: { type: "string", enum: ["latest", "popular", "likes"], default: "latest" },
          },
        ],
        responses: {
          200: {
            description: "List of posts matching filters.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Post" },
                },
              },
            },
          },
          500: { description: "Server error." },
        },
      },
      post: {
        summary: "Create Post",
        description: "Create a new post. Limited to 3 posts per 24 hours per user.",
        tags: ["📝 Posts"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "summary", "content", "education_level"],
                properties: {
                  title: { type: "string" },
                  summary: { type: "string" },
                  content: { type: "string" },
                  education_level: { type: "string", enum: ["MIDDLE_SCHOOL", "HIGH_SCHOOL", "UNIVERSITY"] },
                  post_status: { type: "string", enum: ["DRAFT", "PUBLISHED"], default: "DRAFT" },
                  category_id: { type: "string", format: "uuid", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Post created successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Post" },
              },
            },
          },
          400: { description: "Missing required fields." },
          401: { description: "Unauthorized." },
          429: { description: "Post limit reached (max 3 posts/24h)." },
          500: { description: "Server error." },
        },
      },
    },
    "/posts/trending": {
      get: {
        summary: "Get Trending Posts",
        description: "Retrieve posts trending in the last 7 days.",
        tags: ["📝 Posts"],
        responses: {
          200: {
            description: "List of trending posts.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Post" },
                },
              },
            },
          },
          500: { description: "Server error." },
        },
      },
    },
    "/posts/most-liked": {
      get: {
        summary: "Get Most Liked Posts",
        description: "Retrieve most liked posts.",
        tags: ["📝 Posts"],
        responses: {
          200: {
            description: "List of most liked posts.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Post" },
                },
              },
            },
          },
          500: { description: "Server error." },
        },
      },
    },
    "/posts/user/my-posts": {
      get: {
        summary: "Get My Posts",
        description: "Retrieve posts created by the currently authenticated user.",
        tags: ["📝 Posts"],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "List of user's posts.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Post" },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/posts/{id}": {
      get: {
        summary: "Get Post by ID",
        description: "Retrieve a specific post details by its ID.",
        tags: ["📝 Posts"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Post ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Post details.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Post" },
              },
            },
          },
          404: { description: "Post not found." },
          500: { description: "Server error." },
        },
      },
      put: {
        summary: "Update Post",
        description: "Update the title or status of an existing post.",
        tags: ["📝 Posts"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Post ID",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  post_status: { type: "string", enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Post updated successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Post" },
              },
            },
          },
          401: { description: "Unauthorized." },
          404: { description: "Post not found or not author." },
          500: { description: "Server error." },
        },
      },
      delete: {
        summary: "Soft Delete Post",
        description: "Soft deletes a post by setting its status to ARCHIVED.",
        tags: ["📝 Posts"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Post ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Post archived successfully.",
          },
          401: { description: "Unauthorized." },
          404: { description: "Post not found or not author." },
          500: { description: "Server error." },
        },
      },
    },
    "/comment/post/{postId}": {
      get: {
        summary: "Get Comments for Post",
        description: "Retrieve all comments written under a specific post.",
        tags: ["💬 Comments"],
        parameters: [
          {
            name: "postId",
            in: "path",
            required: true,
            description: "Post ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "List of comments.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Comment" },
                },
              },
            },
          },
          500: { description: "Server error." },
        },
      },
    },
    "/comment": {
      post: {
        summary: "Create Comment",
        description: "Add a comment to a post. Sends a notification to the post owner.",
        tags: ["💬 Comments"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["post_id", "content"],
                properties: {
                  post_id: { type: "string", description: "Post ID" },
                  content: { type: "string", description: "Comment content" },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Comment created successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Comment" },
              },
            },
          },
          401: { description: "Unauthorized." },
          404: { description: "Post not found." },
          500: { description: "Server error." },
        },
      },
    },
    "/comment/{id}": {
      put: {
        summary: "Update Comment",
        description: "Modify an existing comment content.",
        tags: ["💬 Comments"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Comment ID",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["content"],
                properties: {
                  content: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Comment updated successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Comment" },
              },
            },
          },
          401: { description: "Unauthorized." },
          404: { description: "Comment not found or not owner." },
          500: { description: "Server error." },
        },
      },
      delete: {
        summary: "Delete Comment",
        description: "Delete an existing comment.",
        tags: ["💬 Comments"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Comment ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Comment deleted successfully." },
          401: { description: "Unauthorized." },
          404: { description: "Comment not found or not owner." },
          500: { description: "Server error." },
        },
      },
    },
    "/likes/{postId}": {
      get: {
        summary: "Like Status",
        description: "Checks if the current user has liked the post.",
        tags: ["❤️ Likes"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "postId",
            in: "path",
            required: true,
            description: "Post ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Like status.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    liked: { type: "boolean" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
      post: {
        summary: "Toggle Like/Unlike",
        description: "Like the post if not liked yet, or unlike if already liked.",
        tags: ["❤️ Likes"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "postId",
            in: "path",
            required: true,
            description: "Post ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Toggled status.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    liked: { type: "boolean" },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/bookmarks": {
      get: {
        summary: "Get My Bookmarks",
        description: "Retrieve all posts bookmarked by the user.",
        tags: ["🔖 Bookmarks"],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "List of bookmarks.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Bookmark" },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/bookmarks/{postId}": {
      post: {
        summary: "Toggle Bookmark",
        description: "Bookmark a post, or remove it from bookmarks if already bookmarked.",
        tags: ["🔖 Bookmarks"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "postId",
            in: "path",
            required: true,
            description: "Post ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Toggled status.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    bookmarked: { type: "boolean" },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/follow/{userId}": {
      post: {
        summary: "Follow User",
        description: "Follow another user.",
        tags: ["👥 Follow"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            description: "User ID to follow",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Successfully followed." },
          400: { description: "Cannot follow yourself or already followed." },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
      delete: {
        summary: "Unfollow User",
        description: "Unfollow another user.",
        tags: ["👥 Follow"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            description: "User ID to unfollow",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Successfully unfollowed." },
          400: { description: "Not following this user." },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/follow/{userId}/followers": {
      get: {
        summary: "Get Followers",
        description: "Retrieve followers list of a user.",
        tags: ["👥 Follow"],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            description: "User ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "List of followers.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      follower: { $ref: "#/components/schemas/User" },
                    },
                  },
                },
              },
            },
          },
          500: { description: "Server error." },
        },
      },
    },
    "/follow/{userId}/following": {
      get: {
        summary: "Get Following",
        description: "Retrieve users that a specific user follows.",
        tags: ["👥 Follow"],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            description: "User ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "List of following.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      following: { $ref: "#/components/schemas/User" },
                    },
                  },
                },
              },
            },
          },
          500: { description: "Server error." },
        },
      },
    },
    "/notifications": {
      get: {
        summary: "Get My Notifications",
        description: "Retrieve notifications list of the authenticated user.",
        tags: ["🔔 Notifications"],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "List of notifications.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Notification" },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/notifications/read-all": {
      patch: {
        summary: "Mark All as Read",
        description: "Mark all user notifications as read.",
        tags: ["🔔 Notifications"],
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: "All notifications marked as read." },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/notifications/{id}/read": {
      patch: {
        summary: "Mark One as Read",
        description: "Mark a single notification as read.",
        tags: ["🔔 Notifications"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Notification ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Notification marked as read." },
          401: { description: "Unauthorized." },
          404: { description: "Notification not found or not owner." },
          500: { description: "Server error." },
        },
      },
    },
    "/notifications/{id}": {
      delete: {
        summary: "Delete Notification",
        description: "Delete a notification.",
        tags: ["🔔 Notifications"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Notification ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Notification deleted." },
          401: { description: "Unauthorized." },
          404: { description: "Notification not found or not owner." },
          500: { description: "Server error." },
        },
      },
    },
    "/reports": {
      post: {
        summary: "Report a Post",
        description: "Report a post. Limit: 1 report per user per post. If a post gets 10 reports, it will be automatically deactivated (UNACTIVED).",
        tags: ["🚨 Reports"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["post_id", "reason"],
                properties: {
                  post_id: { type: "string", description: "Post ID" },
                  reason: { type: "string", description: "Reason for reporting" },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Report created successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Report" },
              },
            },
          },
          400: { description: "Already reported or invalid data." },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/reports/my": {
      get: {
        summary: "Get My Reports",
        description: "Get list of reports submitted by the logged-in user.",
        tags: ["🚨 Reports"],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "List of reports.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Report" },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/moderator/reports": {
      get: {
        summary: "Get Reported Posts",
        description: "Retrieve all posts that have been reported. Access restricted to MODERATOR and ADMIN roles.",
        tags: ["🛡️ Moderator"],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "List of reports and reported posts.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      reason: { type: "string" },
                      post: { $ref: "#/components/schemas/Post" },
                      user: { $ref: "#/components/schemas/User" },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          403: { description: "Forbidden - Role must be MODERATOR or ADMIN." },
          500: { description: "Server error." },
        },
      },
    },
    "/moderator/posts/{id}/action": {
      post: {
        summary: "Perform Action on Reported Post",
        description: "Perform moderation actions: RESTORE (re-activates post) or SOFT_DELETE (archives post).",
        tags: ["🛡️ Moderator"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Post ID",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action"],
                properties: {
                  action: { type: "string", enum: ["RESTORE", "SOFT_DELETE"] },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Action performed successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    post: { $ref: "#/components/schemas/Post" },
                  },
                },
              },
            },
          },
          400: { description: "Invalid action." },
          401: { description: "Unauthorized." },
          403: { description: "Forbidden." },
          404: { description: "Post not found." },
          500: { description: "Server error." },
        },
      },
    },
    "/admin/users": {
      get: {
        summary: "Get All Users",
        description: "Retrieve all registered users. Role required: ADMIN.",
        tags: ["⚙️ Admin"],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "List of users.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          403: { description: "Forbidden." },
          500: { description: "Server error." },
        },
      },
    },
    "/admin/users/{id}/role": {
      patch: {
        summary: "Change User Role",
        description: "Change user role to MEMBER, MODERATOR, or ADMIN. Role required: ADMIN.",
        tags: ["⚙️ Admin"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "User ID",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["role"],
                properties: {
                  role: { type: "string", enum: ["MEMBER", "MODERATOR", "ADMIN"] },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "User role updated successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          400: { description: "Invalid role." },
          401: { description: "Unauthorized." },
          403: { description: "Forbidden." },
          404: { description: "User not found." },
          500: { description: "Server error." },
        },
      },
    },
    "/users/{id}": {
      get: {
        summary: "Get Public Profile",
        description: "Retrieve public profile information of a user.",
        tags: ["👤 Users"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "User ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "User profile details.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          404: { description: "User not found." },
          500: { description: "Server error." },
        },
      },
    },
    "/users/profile": {
      put: {
        summary: "Update My Profile",
        description: "Update the authenticated user's profile detail.",
        tags: ["👤 Users"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  username: { type: "string" },
                  bio: { type: "string" },
                  education_level: { type: "string", enum: ["MIDDLE_SCHOOL", "HIGH_SCHOOL", "UNIVERSITY"] },
                  profile_image: { type: "string", format: "uri" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Profile updated successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          400: { description: "Username already taken." },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/users/equip": {
      put: {
        summary: "Equip Theme or Frame",
        description: "Equip a purchased theme or frame item. Set itemId to null to unequip.",
        tags: ["👤 Users"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type"],
                properties: {
                  itemId: { type: "string", nullable: true, description: "Shop item ID" },
                  type: { type: "string", enum: ["THEME", "FRAME"], description: "Type of item" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Item equipped successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          400: { description: "Invalid request or item not owned." },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/shop-items": {
      get: {
        summary: "Get All Shop Items",
        description: "Retrieve all active shop items.",
        tags: ["🛍️ Shop Items"],
        parameters: [
          {
            name: "item_type",
            in: "query",
            description: "Filter items by type",
            required: false,
            schema: { type: "string", enum: ["THEME", "FRAME"] },
          },
        ],
        responses: {
          200: {
            description: "List of shop items.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ShopItem" },
                },
              },
            },
          },
          500: { description: "Server error." },
        },
      },
      post: {
        summary: "Create Shop Item (Admin)",
        description: "Add a new item to the shop. Authenticated request.",
        tags: ["🛍️ Shop Items"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id", "item_name", "item_type", "price"],
                properties: {
                  id: { type: "string", description: "Unique item ID code" },
                  item_name: { type: "string" },
                  item_type: { type: "string", enum: ["THEME", "FRAME"] },
                  price: { type: "integer", minimum: 0 },
                  image_url: { type: "string", format: "uri", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Item created successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopItem" },
              },
            },
          },
          400: { description: "Missing or invalid fields." },
          401: { description: "Unauthorized." },
          409: { description: "Item with this ID already exists." },
          500: { description: "Server error." },
        },
      },
    },
    "/shop-items/{id}": {
      get: {
        summary: "Get Shop Item by ID",
        description: "Retrieve detailed shop item by ID.",
        tags: ["🛍️ Shop Items"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Shop Item ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Shop item details.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopItem" },
              },
            },
          },
          404: { description: "Item not found." },
          500: { description: "Server error." },
        },
      },
      put: {
        summary: "Update Shop Item (Admin)",
        description: "Modify shop item attributes.",
        tags: ["🛍️ Shop Items"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Shop Item ID",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  item_name: { type: "string" },
                  item_type: { type: "string", enum: ["THEME", "FRAME"] },
                  price: { type: "integer", minimum: 0 },
                  image_url: { type: "string", format: "uri", nullable: true },
                  is_active: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Item updated successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopItem" },
              },
            },
          },
          400: { description: "Invalid type value." },
          401: { description: "Unauthorized." },
          404: { description: "Shop item not found." },
          500: { description: "Server error." },
        },
      },
      delete: {
        summary: "Deactivate Shop Item (Admin)",
        description: "Soft-delete item by setting is_active to false.",
        tags: ["🛍️ Shop Items"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Shop Item ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Shop item deactivated successfully." },
          401: { description: "Unauthorized." },
          404: { description: "Shop item not found." },
          500: { description: "Server error." },
        },
      },
    },
    "/shop-items/{id}/purchase": {
      post: {
        summary: "Purchase Shop Item",
        description: "Purchase a theme or frame with user's coin balance.",
        tags: ["🛍️ Shop Items"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Shop Item ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          201: {
            description: "Purchase successful.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    purchase: { $ref: "#/components/schemas/Purchase" },
                    coin_balance: { type: "integer" },
                  },
                },
              },
            },
          },
          400: { description: "Insufficient coins or user not found." },
          401: { description: "Unauthorized." },
          404: { description: "Shop item not found or deactivated." },
          409: { description: "Item already owned." },
          500: { description: "Server error." },
        },
      },
    },
    "/quest/user": {
      get: {
        summary: "Get User Quest Progress",
        description: "Get all global quests with the current authenticated user's progress merged in.",
        tags: ["📜 Quests"],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "List of quests with progress data.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      quest_name: { type: "string" },
                      quest_type: { type: "string" },
                      target_value: { type: "integer" },
                      reward_coin: { type: "integer" },
                      is_daily: { type: "boolean" },
                      current_progress: { type: "integer" },
                      completed_at: { type: "string", format: "date-time", nullable: true },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/quest/progress": {
      post: {
        summary: "Update Quest Progress",
        description: "Increment progress towards a quest by a specified amount (defaults to 1).",
        tags: ["📜 Quests"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["quest_id"],
                properties: {
                  quest_id: { type: "string", format: "uuid" },
                  increment: { type: "integer", default: 1 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Progress updated successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    userQuest: { $ref: "#/components/schemas/UserQuest" },
                    target_reached: { type: "boolean" },
                    can_claim_reward: { type: "boolean" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized." },
          404: { description: "Quest not found." },
          500: { description: "Server error." },
        },
      },
    },
    "/quest/claim": {
      post: {
        summary: "Claim Quest Reward",
        description: "Claim coin reward for a completed quest.",
        tags: ["📜 Quests"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["quest_id"],
                properties: {
                  quest_id: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Coins claimed successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    userQuest: { $ref: "#/components/schemas/UserQuest" },
                    newCoinBalance: { type: "integer" },
                  },
                },
              },
            },
          },
          400: { description: "Quest target not reached, already claimed, or not started." },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/quest": {
      get: {
        summary: "Get All Global Quests",
        description: "Retrieve all global quests configured in the system.",
        tags: ["📜 Quests"],
        responses: {
          200: {
            description: "List of all quests.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Quest" },
                },
              },
            },
          },
          500: { description: "Server error." },
        },
      },
      post: {
        summary: "Create Quest (Admin)",
        description: "Create a new global quest setting.",
        tags: ["📜 Quests"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["quest_name", "quest_type", "target_value", "reward_coin"],
                properties: {
                  quest_name: { type: "string" },
                  quest_type: { type: "string" },
                  target_value: { type: "integer", minimum: 1 },
                  reward_coin: { type: "integer", minimum: 1 },
                  is_daily: { type: "boolean", default: false },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Quest created successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Quest" },
              },
            },
          },
          400: { description: "Missing required fields." },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
    "/quest/{id}": {
      put: {
        summary: "Update Quest (Admin)",
        description: "Modify an existing global quest details.",
        tags: ["📜 Quests"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Quest ID",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  quest_name: { type: "string" },
                  quest_type: { type: "string" },
                  target_value: { type: "integer", minimum: 1 },
                  reward_coin: { type: "integer", minimum: 1 },
                  is_daily: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Quest updated.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Quest" },
              },
            },
          },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
      delete: {
        summary: "Delete Quest (Admin)",
        description: "Delete an existing quest setting.",
        tags: ["📜 Quests"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Quest ID",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Quest deleted successfully." },
          401: { description: "Unauthorized." },
          500: { description: "Server error." },
        },
      },
    },
  },
};
