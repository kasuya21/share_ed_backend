# Share-Ed Backend

REST API and real-time backend for the Share-Ed educational content-sharing platform.

[English](#english) · [ภาษาไทย](#ภาษาไทย) · [Swagger](#swagger-ui) · [Postman](#postman-collection)

---

## English

### Overview

Share-Ed Backend manages authentication, educational posts, media, social interactions, moderation, achievements, and notifications. It uses Express and Prisma, Supabase Auth/PostgreSQL/Storage, Cloudinary, Socket.IO, and a database-backed worker.

Key features:

- Registration, email verification, login, logout, and password changes
- Profiles, profile media, inventories, and reward frames
- Posts, categories, tags, search, feeds, trending content, and statistics
- Likes, bookmarks, comments, follows, reports, and notifications
- `MEMBER`, `MODERATOR`, and `ADMIN` access control
- Multipart and provider-signed direct uploads
- Scheduled cleanup and background jobs
- Swagger UI and a generated Postman Collection

### Quick links

| Resource | Location |
| --- | --- |
| Local API | `http://localhost:5000` |
| Local REST base | `http://localhost:5000/api/v1` |
| Swagger UI | `http://localhost:5000/api-docs` |
| OpenAPI JSON | `http://localhost:5000/api-docs.json` |
| OpenAPI file | [swagger.json](swagger.json) |
| Postman Collection | [postman/Share-Ed.postman_collection.json](postman/Share-Ed.postman_collection.json) |
| Production API | `https://api.share-ed.online` |
| Production guide | [docs/EC2_OPERATIONS_GUIDE.md](docs/EC2_OPERATIONS_GUIDE.md) |

### Stack

| Area | Technology |
| --- | --- |
| Runtime/API | Node.js 24, ES modules, Express 5 |
| Database | PostgreSQL, Prisma 7, `@prisma/adapter-pg` |
| Authentication | Supabase Auth |
| Storage | Cloudinary and Supabase Storage |
| Real-time | Socket.IO |
| Uploads | Multer and signed direct uploads |
| Scheduled work | node-cron |
| Deployment | Docker, Amazon ECR, EC2, Systems Manager, GitHub Actions |

### Architecture

```text
Frontend
   |-- REST / HTTPS ----------> Express API
   |                               |-- Supabase Auth
   |                               |-- PostgreSQL via Prisma
   |                               |-- Cloudinary / Supabase Storage
   |                               `-- BackgroundJob table
   |
   `-- Socket.IO ------------> Authenticated user/admin rooms
                                      ^
                                      |
                                Worker process
```

### Prerequisites

- Node.js **24.x** and npm
- PostgreSQL or a Supabase project
- Supabase URL, anonymous key, and a backend secret/service-role key
- Cloudinary credentials for media features
- Docker and Docker Compose for the container workflow

### Quick start

#### 1. Install

```bash
npm ci
```

#### 2. Create `.env`

```powershell
# PowerShell
Copy-Item .env.example .env
```

```bash
# macOS/Linux
cp .env.example .env
```

Fill in the database, Supabase, and Cloudinary values. Never commit `.env` or expose backend secrets to the frontend.

#### 3. Prepare Prisma

```bash
npm run build
npm run migrate:deploy
```

#### 4. Run the API and worker

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run worker
```

Keep the worker running for direct-upload verification, asynchronous notifications, cleanup, and achievement updates.

#### 5. Verify

```bash
curl http://localhost:5000/
curl http://localhost:5000/api/v1/categories
```

Expected health response:

```json
{ "status": "ok" }
```

### API documentation

#### Swagger UI

Start the API and open:

```text
http://localhost:5000/api-docs
```

To call a protected endpoint:

1. Execute `POST /auth/login`.
2. Copy the Supabase `access_token`.
3. Click **Authorize**.
4. Paste only the token, without the `Bearer` prefix.
5. Execute the protected request.

Raw OpenAPI is available at `http://localhost:5000/api-docs.json`. Production uses `https://api.share-ed.online/api-docs`.

#### Postman Collection

Import [postman/Share-Ed.postman_collection.json](postman/Share-Ed.postman_collection.json):

1. Open Postman and click **Import**.
2. Select the collection file.
3. Open **Share-Ed Backend API**.
4. Confirm the `baseUrl` collection variable.
5. Run **Auth → Login**.
6. A successful login automatically saves `accessToken`.
7. Protected requests use `Authorization: Bearer {{accessToken}}` automatically.

| Variable | Usage |
| --- | --- |
| `baseUrl` | Defaults to `http://localhost:5000/api/v1` |
| `accessToken` | Saved automatically after Login |
| `id` | Generic resource ID |
| `userId` | User ID |
| `postId` / `post_id` | Post ID |
| `mediaId` | Media ID |
| `sessionId` | Upload session ID |
| `assetId` | Upload asset ID |

Use `http://localhost:5050/api/v1` with Docker Compose and `https://api.share-ed.online/api/v1` in production.

#### Regenerate documentation

```bash
npm run docs:generate
```

The generator updates Swagger and Postman, adds examples and operation IDs, and compares documented operations with Express routers. It fails with a list of missing or stale routes when they differ. Source: [scripts/generate-api-docs.mjs](scripts/generate-api-docs.mjs).

### Authentication and Socket.IO

Protected REST requests require:

```http
Authorization: Bearer <supabase-access-token>
```

Example:

```bash
curl http://localhost:5000/api/v1/auth/me \
  -H "Authorization: Bearer <supabase-access-token>"
```

The API validates the token through Supabase, then checks the local account status and role. Suspended and banned users are rejected.

Connect Socket.IO to the server origin, not `/api/v1`:

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:5000", {
  auth: { token: supabaseAccessToken },
});
```

Sockets join `user:<user-id>` automatically. Admins also join `role:admin`.

### API modules

All routes are prefixed with `/api/v1`.

| Prefix | Access | Purpose |
| --- | --- | --- |
| `/auth` | Mixed | Registration, login, verification, session, password |
| `/users` | Mixed | Profiles, media, inventory, equipped items |
| `/posts` | Mixed | Feeds, details, statistics, uploads, CRUD |
| `/categories` | Public | Category list |
| `/comment` | Mixed | Comments |
| `/likes`, `/bookmarks` | Authenticated | Likes and saved posts |
| `/follow` | Mixed | Followers, following, follow/unfollow |
| `/notifications` | Authenticated | List, mark read, delete |
| `/reports` | Authenticated | Submit and view reports |
| `/achievements` | Authenticated | Progress and reward claims |
| `/moderator` | Moderator/Admin | Report review and post actions |
| `/admin` | Admin | Users, roles, rewards, achievements, categories |

### Uploads

Multipart uploads pass through bounded memory validation and enforce MIME, file-signature, per-file, and total-request limits.

Enable direct-upload workspace v2 with:

```env
UPLOAD_WORKSPACE_V2_ENABLED=true
```

```text
Create upload session
        ↓
Sign a file
        ↓
Upload directly to the provider
        ↓
Complete and verify the asset
        ↓
Create/update the post
```

| Workspace limit | Value |
| --- | --- |
| Files | 15 |
| Total size | 50 MB |
| PDF | 21 MB |
| Image | 2 MB |
| Session lifetime | 2 hours |
| Cleanup grace period | 24 hours |

### Environment

#### Core and database

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `3000` in code | Example file sets `5000` |
| `NODE_ENV` | Production | — | Use `production` in production |
| `DATABASE_URL` | Yes | — | Runtime PostgreSQL URL |
| `DIRECT_URL` | Recommended | `DATABASE_URL` | Direct URL for Prisma CLI |
| `DB_POOL_MAX` / `DB_POOL_MIN` | No | `20` / `2` | Pool limits |
| `DB_POOL_IDLE_TIMEOUT` | No | `30000` ms | Idle timeout |
| `DB_POOL_CONNECTION_TIMEOUT` | No | `5000` ms | Connection timeout |

#### Supabase and media

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Project URL |
| `SUPABASE_ANON_KEY` | Yes | Session/auth client key |
| `SUPABASE_SECRET_KEY` | One admin key | Preferred backend secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Alternative | Legacy admin-key alternative |
| `SUPABASE_STORAGE_PDF_BUCKET` | No | PDF bucket; default `post-pdfs` |
| `EMAIL_VERIFICATION_REDIRECT_URL` | Verification | Frontend verification page |
| `CLOUDINARY_CLOUD_NAME` | Media | Cloudinary cloud |
| `CLOUDINARY_API_KEY` | Media | Cloudinary key |
| `CLOUDINARY_API_SECRET` | Media | Backend-only secret |

#### Upload and security tuning

| Variable | Default | Purpose |
| --- | --- | --- |
| `POST_PDF_MAX_BYTES` | Example: `20971520` | Direct PDF limit |
| `POST_UPLOAD_TOTAL_MB` | `50`, max `64` | Post multipart total |
| `PROFILE_UPLOAD_TOTAL_MB` | `41`, max `64` | Profile upload total |
| `LEGACY_MULTIPART_CONCURRENCY` | `1`, max `8` | Concurrent multipart requests |
| `UPLOAD_WORKSPACE_V2_ENABLED` | Disabled | Enable when exactly `true` |
| `REQUIRE_MFA_FOR_ROLE_CHANGES` | Disabled | Require an `aal2` admin session |
| `ACCESS_TOKEN_MAX_AGE_SECONDS` | `3600` | Sensitive-operation token age |

### Prisma, Docker, and commands

```bash
# Apply committed migrations
npm run migrate:deploy

# Local schema development only
npx prisma migrate dev --name descriptive_change_name
```

Do not run `prisma migrate dev` in production.

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend
```

Compose maps host `5050` to container `5000`. It currently defines the API container; run the worker separately or add a service with `command: npm run worker`.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install lockfile dependencies |
| `npm run dev` / `npm start` | Start API |
| `npm run worker` | Start worker |
| `npm run build` | Generate Prisma Client |
| `npm run migrate:deploy` | Apply migrations |
| `npm run docs:generate` | Generate Swagger and Postman |

### Project structure

```text
configs/       Runtime configuration
controllers/   Request handlers and business logic
middlewares/   Authentication, authorization, access, uploads
prisma/        Schema and migrations
routers/       Express routes
utils/         Security, validation, storage, logging, cron, jobs
workers/       Background worker
docs/          Operations and setup guides
postman/       Generated Postman Collection
scripts/       Documentation generator
index.js       API and Socket.IO entry point
swagger.json   OpenAPI document
```

### Production and troubleshooting

- API: `https://api.share-ed.online`
- REST: `https://api.share-ed.online/api/v1`
- Socket.IO: `https://api.share-ed.online`

Pushes to `develop` publish the Docker image to ECR and invoke EC2 deployment through Systems Manager. See [docs/EC2_OPERATIONS_GUIDE.md](docs/EC2_OPERATIONS_GUIDE.md).

| Problem | Check |
| --- | --- |
| Database failure | URLs, encoding, Supabase status/network rules |
| `401` | Bearer format, expiry, completed registration |
| `403` | Account status, role, MFA/`aal2` |
| Upload failure | Credentials, bucket, signature, MIME, size |
| `UPLOAD_BUSY` | Retry after the `Retry-After` duration |
| Socket unauthorized | Origin, `auth.token`, `ACTIVE` status |
| Unexpected error | Search logs by response `X-Request-ID` |

Related guides: [Email verification](docs/email-verification-setup.md) · [Error logging](docs/ERROR_LOGGING.md) · [Access control](docs/ACCESS_CONTROL_REVIEW.md) · [Security](SECURITY_REVIEW.md) · [Storage SQL](docs/supabase-storage-setup.sql)

---

## ภาษาไทย

### ภาพรวม

Share-Ed Backend คือ REST API และระบบ real-time สำหรับแพลตฟอร์มแบ่งปันเนื้อหาด้านการศึกษา รองรับ Auth, โพสต์, สื่อ, ฟีเจอร์โซเชียล, Moderation, Achievement และ Notification

ระบบใช้ Express/Prisma, Supabase Auth/PostgreSQL/Storage, Cloudinary, Socket.IO และ worker สำหรับงานเบื้องหลัง

ความสามารถหลัก:

- สมัครสมาชิก ยืนยันอีเมล Login Logout และเปลี่ยนรหัสผ่าน
- โปรไฟล์ สื่อโปรไฟล์ Inventory และกรอบรางวัล
- โพสต์ หมวดหมู่ แท็ก ค้นหา Feed Trending และสถิติ
- Like, Bookmark, Comment, Follow, Report และ Notification
- สิทธิ์ `MEMBER`, `MODERATOR` และ `ADMIN`
- Multipart upload และ direct-upload workspace
- Swagger UI และ Postman Collection พร้อมใช้งาน

### ลิงก์สำคัญ

| รายการ | ตำแหน่ง |
| --- | --- |
| Local API | `http://localhost:5000` |
| REST base | `http://localhost:5000/api/v1` |
| Swagger UI | `http://localhost:5000/api-docs` |
| OpenAPI JSON | `http://localhost:5000/api-docs.json` |
| OpenAPI file | [swagger.json](swagger.json) |
| Postman Collection | [postman/Share-Ed.postman_collection.json](postman/Share-Ed.postman_collection.json) |
| Production API | `https://api.share-ed.online` |
| คู่มือ Production | [docs/EC2_OPERATIONS_GUIDE.md](docs/EC2_OPERATIONS_GUIDE.md) |

### เริ่มต้นใช้งาน

#### 1. ติดตั้ง Dependencies

```bash
npm ci
```

#### 2. สร้างไฟล์ `.env`

```powershell
# PowerShell
Copy-Item .env.example .env
```

```bash
# macOS/Linux
cp .env.example .env
```

กรอกค่าฐานข้อมูล, Supabase และ Cloudinary ห้าม commit `.env` หรือนำ Backend Secret ไปใช้ใน Frontend

#### 3. เตรียม Prisma

```bash
npm run build
npm run migrate:deploy
```

#### 4. เปิด API และ Worker

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run worker
```

ควรเปิด Worker เมื่อใช้ Direct Upload, Notification แบบเบื้องหลัง, Cleanup และ Achievement

#### 5. ตรวจระบบ

```bash
curl http://localhost:5000/
curl http://localhost:5000/api/v1/categories
```

Health endpoint ต้องตอบ:

```json
{ "status": "ok" }
```

### วิธีใช้ Swagger

เปิด API แล้วเข้า:

```text
http://localhost:5000/api-docs
```

วิธีเรียก Endpoint ที่ต้อง Login:

1. เรียก `POST /auth/login`
2. คัดลอก `access_token` จาก Response
3. กด **Authorize**
4. วางเฉพาะ Token ไม่ต้องใส่คำว่า `Bearer`
5. เรียก Endpoint ที่ต้องการ

OpenAPI JSON อยู่ที่ `http://localhost:5000/api-docs.json` และ Production UI อยู่ที่ `https://api.share-ed.online/api-docs`

### วิธีใช้ Postman

Import [postman/Share-Ed.postman_collection.json](postman/Share-Ed.postman_collection.json):

1. เปิด Postman แล้วกด **Import**
2. เลือกไฟล์ Collection
3. เปิด Collection ชื่อ **Share-Ed Backend API**
4. ตรวจตัวแปร `baseUrl`
5. เรียก **Auth → Login**
6. เมื่อ Login สำเร็จ ระบบจะบันทึก `accessToken` อัตโนมัติ
7. Requests ที่ป้องกันไว้จะส่ง Bearer Token ให้อัตโนมัติ

| ตัวแปร | การใช้งาน |
| --- | --- |
| `baseUrl` | ค่าเริ่มต้น `http://localhost:5000/api/v1` |
| `accessToken` | บันทึกอัตโนมัติจาก Login |
| `id` | Resource ID ทั่วไป |
| `userId` | User ID |
| `postId` / `post_id` | Post ID |
| `mediaId` | Media ID |
| `sessionId` | Upload Session ID |
| `assetId` | Upload Asset ID |

Docker Compose ใช้ `http://localhost:5050/api/v1` และ Production ใช้ `https://api.share-ed.online/api/v1`

หลังแก้ Routes หรือเอกสาร API ให้สร้าง Swagger/Postman ใหม่:

```bash
npm run docs:generate
```

Generator จะเปรียบเทียบ Express Routes กับเอกสาร และแจ้งรายการ Route ที่ขาดหรือเกิน โค้ดอยู่ที่ [scripts/generate-api-docs.mjs](scripts/generate-api-docs.mjs)

### Authentication และ Socket.IO

Endpoint ที่ป้องกันไว้ต้องส่ง:

```http
Authorization: Bearer <supabase-access-token>
```

```bash
curl http://localhost:5000/api/v1/auth/me \
  -H "Authorization: Bearer <supabase-access-token>"
```

API ตรวจ Token กับ Supabase และตรวจสถานะ/Role ในฐานข้อมูล ผู้ใช้ที่ถูก Suspend หรือ Ban จะถูกปฏิเสธ

Socket.IO ต้องต่อที่ Server Origin โดยไม่ใส่ `/api/v1`:

```js
const socket = io("http://localhost:5000", {
  auth: { token: supabaseAccessToken },
});
```

Socket จะเข้า `user:<user-id>` อัตโนมัติ และ Admin จะเข้า `role:admin` เพิ่มเติม

### หมวดหมู่ API

ทุก Route ขึ้นต้นด้วย `/api/v1`

| Prefix | สิทธิ์ | หน้าที่ |
| --- | --- | --- |
| `/auth` | ผสม | สมัคร, Login, Verification, Session, Password |
| `/users` | ผสม | โปรไฟล์ สื่อ Inventory และ Equipped Items |
| `/posts` | ผสม | Feed, Detail, Statistics, Upload และ CRUD |
| `/categories` | สาธารณะ | หมวดหมู่ |
| `/comment` | ผสม | ความคิดเห็น |
| `/likes`, `/bookmarks` | ต้อง Login | Like และ Bookmark |
| `/follow` | ผสม | Followers, Following, Follow/Unfollow |
| `/notifications` | ต้อง Login | อ่าน ทำเครื่องหมาย และลบ |
| `/reports` | ต้อง Login | ส่งและดู Report |
| `/achievements` | ต้อง Login | ความคืบหน้าและรับรางวัล |
| `/moderator` | Moderator/Admin | ตรวจ Report และจัดการโพสต์ |
| `/admin` | Admin | ผู้ใช้ Role รางวัล Achievement และหมวดหมู่ |

### วิธีอัปโหลด

Multipart Upload จะผ่าน API ซึ่งตรวจ MIME, File Signature, ขนาดต่อไฟล์ และขนาดรวม

เปิด Direct-upload Workspace ด้วย:

```env
UPLOAD_WORKSPACE_V2_ENABLED=true
```

```text
สร้าง Upload Session
        ↓
ขอลายเซ็นไฟล์
        ↓
อัปโหลดตรงไป Provider
        ↓
แจ้ง Complete และตรวจไฟล์
        ↓
สร้างหรือแก้ไขโพสต์
```

| ข้อจำกัด | ค่า |
| --- | --- |
| จำนวนไฟล์ | 15 |
| ขนาดรวม | 50 MB |
| PDF | 21 MB |
| รูปภาพ | 2 MB |
| อายุ Session | 2 ชั่วโมง |
| ระยะก่อน Cleanup | 24 ชั่วโมง |

### Environment Variables

#### ระบบหลักและฐานข้อมูล

| ตัวแปร | จำเป็น | ค่าเริ่มต้น | หน้าที่ |
| --- | --- | --- | --- |
| `PORT` | ไม่ | ในโค้ด `3000` | ไฟล์ตัวอย่างใช้ `5000` |
| `NODE_ENV` | Production | — | กำหนดเป็น `production` |
| `DATABASE_URL` | ใช่ | — | PostgreSQL URL สำหรับ Runtime |
| `DIRECT_URL` | แนะนำ | `DATABASE_URL` | Direct URL สำหรับ Prisma CLI |
| `DB_POOL_MAX` / `DB_POOL_MIN` | ไม่ | `20` / `2` | ขนาด Connection Pool |
| `DB_POOL_IDLE_TIMEOUT` | ไม่ | `30000` ms | Idle Timeout |
| `DB_POOL_CONNECTION_TIMEOUT` | ไม่ | `5000` ms | Connection Timeout |

#### Supabase และ Media

| ตัวแปร | จำเป็น | หน้าที่ |
| --- | --- | --- |
| `SUPABASE_URL` | ใช่ | Supabase Project URL |
| `SUPABASE_ANON_KEY` | ใช่ | Key สำหรับ Session/Auth |
| `SUPABASE_SECRET_KEY` | ต้องมี Admin Key หนึ่งค่า | Backend Secret ที่แนะนำ |
| `SUPABASE_SERVICE_ROLE_KEY` | ใช้แทนได้ | ตัวเลือกเดิมแทน Secret Key |
| `SUPABASE_STORAGE_PDF_BUCKET` | ไม่ | PDF Bucket; ค่าเริ่มต้น `post-pdfs` |
| `EMAIL_VERIFICATION_REDIRECT_URL` | Verification | หน้า Frontend หลังยืนยันอีเมล |
| `CLOUDINARY_CLOUD_NAME` | Media | Cloudinary Cloud |
| `CLOUDINARY_API_KEY` | Media | Cloudinary Key |
| `CLOUDINARY_API_SECRET` | Media | Secret เฉพาะ Backend |

#### Upload และ Security

| ตัวแปร | ค่าเริ่มต้น | หน้าที่ |
| --- | --- | --- |
| `POST_PDF_MAX_BYTES` | ตัวอย่าง `20971520` | ขนาด PDF |
| `POST_UPLOAD_TOTAL_MB` | `50`, สูงสุด `64` | ขนาดรวม Post Upload |
| `PROFILE_UPLOAD_TOTAL_MB` | `41`, สูงสุด `64` | ขนาดรวม Profile Upload |
| `LEGACY_MULTIPART_CONCURRENCY` | `1`, สูงสุด `8` | Multipart พร้อมกัน |
| `UPLOAD_WORKSPACE_V2_ENABLED` | ปิด | เปิดเมื่อเป็น `true` |
| `REQUIRE_MFA_FOR_ROLE_CHANGES` | ปิด | บังคับ Admin Session ระดับ `aal2` |
| `ACCESS_TOKEN_MAX_AGE_SECONDS` | `3600` | อายุ Token สำหรับงานสำคัญ |

### Prisma, Docker และคำสั่ง

```bash
# ใช้ Migrations ที่ Commit แล้ว
npm run migrate:deploy

# สร้าง Migration บนเครื่องพัฒนาเท่านั้น
npx prisma migrate dev --name descriptive_change_name
```

ห้ามใช้ `prisma migrate dev` บน Production

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend
```

Compose Map พอร์ตเครื่อง `5050` ไป Container `5000` ปัจจุบันมีเฉพาะ API Container จึงต้องเปิด Worker แยกหรือเพิ่ม Service ด้วย `command: npm run worker`

| คำสั่ง | หน้าที่ |
| --- | --- |
| `npm ci` | ติดตั้ง Dependencies ตาม Lockfile |
| `npm run dev` / `npm start` | เปิด API |
| `npm run worker` | เปิด Worker |
| `npm run build` | สร้าง Prisma Client |
| `npm run migrate:deploy` | ใช้ Migrations |
| `npm run docs:generate` | สร้าง Swagger และ Postman |

### โครงสร้างโปรเจกต์

```text
configs/       การตั้งค่า Runtime
controllers/   Request Handlers และ Business Logic
middlewares/   Auth, Role, Access และ Upload
prisma/        Schema และ Migrations
routers/       Express Routes
utils/         Security, Validation, Storage, Logging, Cron, Jobs
workers/       Background Worker
docs/          คู่มือระบบ
postman/       Postman Collection
scripts/       Documentation Generator
index.js       API และ Socket.IO Entry Point
swagger.json   OpenAPI Document
```

### Production และแก้ปัญหา

- API: `https://api.share-ed.online`
- REST: `https://api.share-ed.online/api/v1`
- Socket.IO: `https://api.share-ed.online`

เมื่อ Push เข้า `develop` ระบบจะ Publish Docker Image ไป ECR และ Deploy EC2 ผ่าน Systems Manager รายละเอียดอยู่ที่ [docs/EC2_OPERATIONS_GUIDE.md](docs/EC2_OPERATIONS_GUIDE.md)

| ปัญหา | สิ่งที่ควรตรวจ |
| --- | --- |
| ต่อฐานข้อมูลไม่ได้ | URLs, Encoding, Supabase Status/Network |
| `401` | Bearer Format, Token หมดอายุ, Registration |
| `403` | สถานะบัญชี, Role, MFA/`aal2` |
| Upload ไม่สำเร็จ | Credentials, Bucket, Signature, MIME, ขนาด |
| `UPLOAD_BUSY` | รอตาม `Retry-After` |
| Socket Unauthorized | Origin, `auth.token`, สถานะ `ACTIVE` |
| API Error | ค้น Log ด้วย `X-Request-ID` |

เอกสารเพิ่มเติม: [Email Verification](docs/email-verification-setup.md) · [Error Logging](docs/ERROR_LOGGING.md) · [Access Control](docs/ACCESS_CONTROL_REVIEW.md) · [Security](SECURITY_REVIEW.md) · [Storage SQL](docs/supabase-storage-setup.sql)
