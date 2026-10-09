import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const swaggerPath = resolve(projectRoot, "swagger.json");
const postmanPath = resolve(projectRoot, "postman", "Share-Ed.postman_collection.json");
const swagger = JSON.parse(await readFile(swaggerPath, "utf8"));

const bearer = [{ BearerAuth: [] }];
const jsonContent = schema => ({
  "application/json": { schema },
});
const jsonBody = (schema, required = true) => ({
  required,
  content: jsonContent(schema),
});
const pathParameter = (name, description = `${name} identifier`) => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string" },
});
const queryParameter = (name, schema, description, required = false) => ({
  name,
  in: "query",
  required,
  description,
  schema,
});
const responses = (successDescription = "Successful response.", successStatus = "200") => ({
  [successStatus]: {
    description: successDescription,
    content: jsonContent({
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
        data: {},
      },
    }),
  },
  "400": { description: "Invalid request." },
  "401": { description: "Authentication is required or the token is invalid." },
  "403": { description: "The caller does not have access to this resource." },
  "404": { description: "Resource not found." },
  "429": { description: "Rate limit exceeded." },
  "500": { description: "Unexpected server error." },
});
const operation = ({
  summary,
  description,
  tag,
  security,
  parameters,
  requestBody,
  successDescription,
  successStatus,
}) => ({
  summary,
  ...(description ? { description } : {}),
  tags: [tag],
  ...(security ? { security: bearer } : {}),
  ...(parameters?.length ? { parameters } : {}),
  ...(requestBody ? { requestBody } : {}),
  responses: responses(successDescription, successStatus),
});

swagger.openapi = "3.0.3";
swagger.info = {
  title: "Share-Ed Backend API",
  version: "1.0.0",
  description:
    "REST API for Share-Ed. Protected endpoints use a Supabase access token as a Bearer token.",
};
swagger.servers = [
  { url: "http://localhost:5000/api/v1", description: "Local development" },
  { url: "http://localhost:5050/api/v1", description: "Local Docker Compose" },
  { url: "https://api.share-ed.online/api/v1", description: "Production" },
];
swagger.tags = [
  { name: "Auth", description: "Registration, sessions, and password management" },
  { name: "Users", description: "Profiles, inventory, and equipped items" },
  { name: "Posts", description: "Posts, feeds, media, and upload signatures" },
  { name: "Upload Workspace", description: "Direct-upload sessions and assets" },
  { name: "Categories", description: "Public categories" },
  { name: "Comments", description: "Post comments" },
  { name: "Likes", description: "Post likes" },
  { name: "Bookmarks", description: "Saved posts" },
  { name: "Follow", description: "Follower relationships" },
  { name: "Notifications", description: "User notifications" },
  { name: "Reports", description: "Content reports" },
  { name: "Achievements", description: "Achievement progress and claims" },
  { name: "Moderator", description: "Report review and moderation actions" },
  { name: "Admin", description: "Administrative user and category operations" },
  { name: "Admin Rewards", description: "Administrative reward operations" },
  { name: "Admin Achievements", description: "Administrative achievement operations" },
];

swagger.components ??= {};
swagger.components.securitySchemes ??= {};
swagger.components.securitySchemes.BearerAuth = {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Supabase access token",
};
swagger.components.schemas ??= {};
Object.assign(swagger.components.schemas, {
  Error: {
    type: "object",
    properties: {
      success: { type: "boolean", example: false },
      code: { type: "string", example: "INVALID_REQUEST" },
      message: { type: "string", example: "Invalid request" },
    },
  },
  Category: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string", example: "Mathematics" },
      _count: {
        type: "object",
        properties: { posts: { type: "integer", example: 12 } },
      },
    },
  },
  UploadSession: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      status: { type: "string", enum: ["OPEN", "PENDING", "COMPLETED", "EXPIRED", "CLEANED"] },
      expires_at: { type: "string", format: "date-time" },
      assets: { type: "array", items: { $ref: "#/components/schemas/UploadAsset" } },
    },
  },
  UploadAsset: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      asset_type: { type: "string", enum: ["COVER", "IMAGE", "PDF"] },
      status: { type: "string", enum: ["PENDING", "UPLOADED", "VERIFIED", "FAILED", "DELETED"] },
      original_name: { type: "string" },
      content_type: { type: "string" },
      size: { type: "integer" },
    },
  },
});

swagger.paths ??= {};

swagger.paths["/auth/resend-verification"] = {
  post: operation({
    summary: "Resend email verification code",
    tag: "Auth",
    requestBody: jsonBody({
      type: "object",
      required: ["email"],
      properties: { email: { type: "string", format: "email", example: "member@example.com" } },
    }),
    successDescription: "The verification email request was accepted.",
  }),
};

swagger.paths["/categories"] = {
  get: operation({
    summary: "List categories",
    tag: "Categories",
    successDescription: "Category list.",
  }),
};

swagger.paths["/posts/upload-signature"] = {
  get: operation({
    summary: "Create one upload signature",
    tag: "Posts",
    security: true,
    parameters: [
      queryParameter(
        "type",
        { type: "string", enum: ["cover", "media", "pdf"] },
        "Upload target type.",
        true,
      ),
    ],
    successDescription: "Signed upload parameters.",
  }),
};

swagger.paths["/posts/upload-signatures"] = {
  post: operation({
    summary: "Create multiple image upload signatures",
    tag: "Posts",
    security: true,
    requestBody: jsonBody({
      type: "object",
      required: ["types"],
      properties: {
        types: {
          type: "array",
          minItems: 1,
          items: { type: "string", enum: ["cover", "media"] },
          example: ["cover", "media"],
        },
      },
    }),
    successDescription: "Signed upload parameters.",
  }),
};

swagger.paths["/posts/upload-signatures/pdf"] = {
  post: operation({
    summary: "Create a PDF upload signature",
    tag: "Posts",
    security: true,
    requestBody: jsonBody({
      type: "object",
      properties: {
        upload_session_id: { type: "string", format: "uuid" },
        original_name: { type: "string", example: "lesson.pdf" },
        size: { type: "integer", example: 1048576 },
      },
    }, false),
    successDescription: "Signed PDF upload parameters.",
  }),
};

swagger.paths["/posts/upload-sessions"] = {
  post: operation({
    summary: "Create or reuse an upload session",
    tag: "Upload Workspace",
    security: true,
    requestBody: jsonBody({
      type: "object",
      properties: {
        draft_id: { type: "string", description: "Idempotency key for a draft." },
      },
    }, false),
    successDescription: "Upload session.",
  }),
};

swagger.paths["/posts/upload-sessions/{sessionId}"] = {
  get: operation({
    summary: "Get upload session status",
    tag: "Upload Workspace",
    security: true,
    parameters: [pathParameter("sessionId", "Upload session ID.")],
    successDescription: "Upload session and assets.",
  }),
  delete: operation({
    summary: "Delete an upload session",
    tag: "Upload Workspace",
    security: true,
    parameters: [pathParameter("sessionId", "Upload session ID.")],
    successDescription: "Upload session deleted or scheduled for cleanup.",
  }),
};

swagger.paths["/posts/upload-sessions/{sessionId}/files/sign"] = {
  post: operation({
    summary: "Sign one direct upload",
    tag: "Upload Workspace",
    security: true,
    parameters: [pathParameter("sessionId", "Upload session ID.")],
    requestBody: jsonBody({
      type: "object",
      required: ["client_file_id", "asset_type", "original_name", "content_type", "size"],
      properties: {
        client_file_id: { type: "string", example: "local-file-1" },
        asset_type: { type: "string", enum: ["COVER", "IMAGE", "PDF"] },
        original_name: { type: "string", example: "lesson.pdf" },
        content_type: { type: "string", example: "application/pdf" },
        size: { type: "integer", example: 1048576 },
      },
    }),
    successDescription: "Provider upload instructions.",
  }),
};

swagger.paths["/posts/upload-sessions/{sessionId}/files/{assetId}/complete"] = {
  post: operation({
    summary: "Complete and verify a direct upload",
    tag: "Upload Workspace",
    security: true,
    parameters: [
      pathParameter("sessionId", "Upload session ID."),
      pathParameter("assetId", "Upload asset ID."),
    ],
    requestBody: jsonBody({
      type: "object",
      description: "Provider completion metadata returned after upload.",
      additionalProperties: true,
      example: { public_id: "share-ed/example", bytes: 1048576, format: "pdf" },
    }),
    successDescription: "Verified upload asset.",
  }),
};

swagger.paths["/posts/upload-sessions/{sessionId}/files/{assetId}"] = {
  delete: operation({
    summary: "Delete an upload asset",
    tag: "Upload Workspace",
    security: true,
    parameters: [
      pathParameter("sessionId", "Upload session ID."),
      pathParameter("assetId", "Upload asset ID."),
    ],
    successDescription: "Upload asset deleted or scheduled for cleanup.",
  }),
};

swagger.paths["/posts/{postId}/media/{mediaId}/download"] = {
  get: operation({
    summary: "Get or follow a protected media download",
    description:
      "Returns a redirect by default. Send Accept: application/json or redirect=false to receive a signed URL as JSON.",
    tag: "Posts",
    security: true,
    parameters: [
      pathParameter("postId", "Post ID."),
      pathParameter("mediaId", "Post media ID."),
      queryParameter("redirect", { type: "boolean", default: true }, "Redirect to the signed URL."),
    ],
    successDescription: "Redirect or signed download URL.",
  }),
};

swagger.paths["/admin/rewards"] = {
  get: operation({
    summary: "List reward items",
    tag: "Admin Rewards",
    security: true,
    successDescription: "Reward item list.",
  }),
  post: operation({
    summary: "Create a reward item",
    tag: "Admin Rewards",
    security: true,
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["item_name", "item_type"],
            properties: {
              item_name: { type: "string", example: "Gold Frame" },
              description: { type: "string" },
              item_type: { type: "string", enum: ["FRAME"] },
              is_active: { type: "boolean", default: true },
              image: { type: "string", format: "binary" },
            },
          },
        },
      },
    },
    successDescription: "Reward item created.",
    successStatus: "201",
  }),
};

swagger.paths["/admin/rewards/{id}"] = {
  put: operation({
    summary: "Update a reward item",
    tag: "Admin Rewards",
    security: true,
    parameters: [pathParameter("id", "Reward item ID.")],
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: {
              item_name: { type: "string" },
              description: { type: "string" },
              item_type: { type: "string", enum: ["FRAME"] },
              image: { type: "string", format: "binary" },
            },
          },
        },
      },
    },
    successDescription: "Reward item updated.",
  }),
  delete: operation({
    summary: "Delete a reward item",
    tag: "Admin Rewards",
    security: true,
    parameters: [pathParameter("id", "Reward item ID.")],
    successDescription: "Reward item deleted.",
  }),
};

swagger.paths["/admin/rewards/{id}/status"] = {
  patch: operation({
    summary: "Change reward item status",
    tag: "Admin Rewards",
    security: true,
    parameters: [pathParameter("id", "Reward item ID.")],
    requestBody: jsonBody({
      type: "object",
      required: ["is_active"],
      properties: { is_active: { type: "boolean", example: true } },
    }),
    successDescription: "Reward item status updated.",
  }),
};

swagger.paths["/admin/categories"] = {
  post: operation({
    summary: "Create a category",
    tag: "Admin",
    security: true,
    requestBody: jsonBody({
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", example: "Mathematics" } },
    }),
    successDescription: "Category created.",
    successStatus: "201",
  }),
};

swagger.paths["/admin/categories/{id}"] = {
  put: operation({
    summary: "Update a category",
    tag: "Admin",
    security: true,
    parameters: [pathParameter("id", "Category ID.")],
    requestBody: jsonBody({
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", example: "Advanced Mathematics" } },
    }),
    successDescription: "Category updated.",
  }),
  delete: operation({
    summary: "Delete a category",
    tag: "Admin",
    security: true,
    parameters: [pathParameter("id", "Category ID.")],
    successDescription: "Category deleted.",
  }),
};

// The implementation uses :post_id. Replace the stale documented :id route.
if (swagger.paths["/moderator/posts/{id}/action"]) {
  swagger.paths["/moderator/posts/{post_id}/action"] =
    swagger.paths["/moderator/posts/{id}/action"];
  delete swagger.paths["/moderator/posts/{id}/action"];
}
const moderatorAction = swagger.paths["/moderator/posts/{post_id}/action"]?.post;
if (moderatorAction) {
  moderatorAction.parameters = [pathParameter("post_id", "Post ID.")];
}

// The route is protected in the implementation.
if (swagger.paths["/posts/{id}"]?.get) {
  swagger.paths["/posts/{id}"].get.security = bearer;
}

const tagAliases = new Map([
  ["🔐 Auth", "Auth"],
  ["👤 Users", "Users"],
  ["📝 Posts", "Posts"],
  ["💬 Comments", "Comments"],
  ["❤️ Likes", "Likes"],
  ["🔖 Bookmarks", "Bookmarks"],
  ["👥 Follow", "Follow"],
  ["🔔 Notifications", "Notifications"],
  ["🚨 Reports", "Reports"],
  ["🏆 Achievements", "Achievements"],
  ["🛡️ Moderator", "Moderator"],
  ["⚙️ Admin", "Admin"],
  ["⚙️ Admin Achievements", "Admin Achievements"],
]);

const operationIds = new Set();
for (const [path, pathItem] of Object.entries(swagger.paths)) {
  for (const [method, apiOperation] of Object.entries(pathItem)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    apiOperation.tags = (apiOperation.tags || []).map(tag => tagAliases.get(tag) || tag);
    const baseId = `${method}_${path}`
      .replace(/[{}]/g, "")
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, next) => next.toUpperCase())
      .replace(/[^a-zA-Z0-9]/g, "");
    let operationId = baseId;
    let suffix = 2;
    while (operationIds.has(operationId)) operationId = `${baseId}${suffix++}`;
    apiOperation.operationId = operationId;
    operationIds.add(operationId);
  }
}

const preferredTagOrder = swagger.tags.map(tag => tag.name);
const sortedPaths = Object.fromEntries(
  Object.entries(swagger.paths).sort(([left], [right]) => left.localeCompare(right)),
);
swagger.paths = sortedPaths;

const routeMounts = {
  "achievement.router.js": "/achievements",
  "admin.router.js": "/admin",
  "auth.router.js": "/auth",
  "bookmark.router.js": "/bookmarks",
  "category.router.js": "/categories",
  "comment.router.js": "/comment",
  "follow.router.js": "/follow",
  "like.router.js": "/likes",
  "moderator.router.js": "/moderator",
  "notification.router.js": "/notifications",
  "post.router.js": "/posts",
  "report.router.js": "/reports",
  "user.router.js": "/users",
};
const implementedOperations = new Set();
const routePattern = /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)/g;
for (const [filename, mountPath] of Object.entries(routeMounts)) {
  const source = await readFile(resolve(projectRoot, "routers", filename), "utf8");
  for (const match of source.matchAll(routePattern)) {
    const routePath = `${mountPath}${match[2]}`
      .replace(/\/$/, "")
      .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
    implementedOperations.add(`${match[1].toUpperCase()} ${routePath}`);
  }
}
const documentedOperations = new Set(
  Object.entries(swagger.paths).flatMap(([path, pathItem]) =>
    Object.keys(pathItem)
      .filter(method => ["get", "post", "put", "patch", "delete"].includes(method))
      .map(method => `${method.toUpperCase()} ${path}`)),
);
const undocumented = [...implementedOperations].filter(item => !documentedOperations.has(item));
const stale = [...documentedOperations].filter(item => !implementedOperations.has(item));
if (undocumented.length || stale.length) {
  throw new Error([
    undocumented.length ? `Undocumented routes:\n- ${undocumented.join("\n- ")}` : "",
    stale.length ? `Documented routes missing from routers:\n- ${stale.join("\n- ")}` : "",
  ].filter(Boolean).join("\n"));
}

await writeFile(swaggerPath, `${JSON.stringify(swagger, null, 2)}\n`, "utf8");

function resolveSchema(schema) {
  if (!schema) return {};
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1);
    return swagger.components.schemas[name] || {};
  }
  return schema;
}

function exampleFor(schema, depth = 0) {
  schema = resolveSchema(schema);
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (depth > 4) return null;
  if (schema.type === "array") return [exampleFor(schema.items, depth + 1)];
  if (schema.type === "integer" || schema.type === "number") return 1;
  if (schema.type === "boolean") return true;
  if (schema.type === "string") {
    if (schema.format === "email") return "member@example.com";
    if (schema.format === "uuid") return "00000000-0000-4000-8000-000000000000";
    if (schema.format === "date-time") return "2026-01-01T00:00:00.000Z";
    if (schema.format === "binary") return "";
    return "string";
  }
  const properties = schema.properties || {};
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, exampleFor(value, depth + 1)]),
  );
}

function postmanBody(requestBody) {
  const content = requestBody?.content || {};
  if (content["application/json"]) {
    const example = exampleFor(content["application/json"].schema);
    return {
      mode: "raw",
      raw: JSON.stringify(example, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  if (content["multipart/form-data"]) {
    const schema = resolveSchema(content["multipart/form-data"].schema);
    return {
      mode: "formdata",
      formdata: Object.entries(schema.properties || {}).map(([key, value]) => ({
        key,
        type: value.format === "binary" ? "file" : "text",
        ...(value.format === "binary"
          ? { src: [] }
          : { value: String(exampleFor(value) ?? "") }),
        description: value.description || "",
        disabled: !(schema.required || []).includes(key),
      })),
    };
  }
  return undefined;
}

const variableNames = new Set(["baseUrl", "accessToken"]);
const folders = new Map();
for (const [path, pathItem] of Object.entries(swagger.paths)) {
  for (const [method, apiOperation] of Object.entries(pathItem)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    const tag = apiOperation.tags?.[0] || "Other";
    if (!folders.has(tag)) folders.set(tag, []);

    const postmanPath = path.replaceAll(/{([^}]+)}/g, (_, name) => {
      variableNames.add(name);
      return `{{${name}}}`;
    });
    const query = (apiOperation.parameters || [])
      .filter(parameter => parameter.in === "query")
      .map(parameter => ({
        key: parameter.name,
        value: String(exampleFor(parameter.schema) ?? ""),
        description: parameter.description || "",
        disabled: !parameter.required,
      }));
    const headers = [];
    const body = postmanBody(apiOperation.requestBody);
    if (body?.mode === "raw") headers.push({ key: "Content-Type", value: "application/json" });

    const request = {
      method: method.toUpperCase(),
      header: headers,
      ...(apiOperation.security ? {} : { auth: { type: "noauth" } }),
      url: {
        raw: `{{baseUrl}}${postmanPath}${query.length ? "?" : ""}${query
          .map(item => `${item.key}=${encodeURIComponent(item.value)}`)
          .join("&")}`,
        host: ["{{baseUrl}}"],
        path: postmanPath.split("/").filter(Boolean),
        ...(query.length ? { query } : {}),
      },
      description: apiOperation.description || apiOperation.summary || "",
      ...(body ? { body } : {}),
    };

    const item = {
      name: apiOperation.summary || apiOperation.operationId,
      request,
      response: [],
    };
    if (path === "/auth/login" && method === "post") {
      item.event = [{
        listen: "test",
        script: {
          type: "text/javascript",
          exec: [
            "if (pm.response.code >= 200 && pm.response.code < 300) {",
            "  const json = pm.response.json();",
            "  const token = json?.data?.session?.access_token || json?.session?.access_token || json?.access_token;",
            "  if (token) pm.collectionVariables.set('accessToken', token);",
            "}",
          ],
        },
      }];
    }
    folders.get(tag).push(item);
  }
}

const collection = {
  info: {
    _postman_id: "798ef648-2c11-4cef-a77d-6b2aa5fb6d55",
    name: "Share-Ed Backend API",
    description:
      "Generated from swagger.json. Run the Login request to save its access token into the collection automatically.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: {
    type: "bearer",
    bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }],
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:5000/api/v1", type: "string" },
    { key: "accessToken", value: "", type: "string" },
    ...[...variableNames]
      .filter(name => !["baseUrl", "accessToken"].includes(name))
      .sort()
      .map(name => ({ key: name, value: "", type: "string" })),
  ],
  item: [...folders.entries()]
    .sort(([left], [right]) =>
      preferredTagOrder.indexOf(left) - preferredTagOrder.indexOf(right)
      || left.localeCompare(right))
    .map(([name, item]) => ({ name, item })),
};

await mkdir(dirname(postmanPath), { recursive: true });
await writeFile(postmanPath, `${JSON.stringify(collection, null, 2)}\n`, "utf8");
console.log(`Generated ${swaggerPath}`);
console.log(`Generated ${postmanPath}`);
