Share-Ed Backend

คู่มือฉบับย่อสำหรับตรวจสอบและดูแล Share-Ed Backend ที่รันด้วย Docker Compose บน Amazon EC2

## โครงสร้างระบบ Production

```text
Frontend (https://share-ed.online)
        |
        v
DNS: api.share-ed.online
        |
        v
EC2 + Caddy (HTTPS 80/443)
        |
        v
Backend container (port 5000 ภายใน Docker)
        |
        v
Supabase PostgreSQL / Auth / Storage
```

- AWS Region: `ap-southeast-1` (Singapore)
- โฟลเดอร์บน EC2: `/opt/share-ed`
- API: `https://api.share-ed.online`
- ECR repository: `997229934476.dkr.ecr.ap-southeast-1.amazonaws.com/share-ed-backend`
- Branch ที่ใช้ build image: `develop`
- ไม่เปิด port `5000` สู่ Internet; Caddy ติดต่อ backend ผ่าน Docker network เท่านั้น

## เข้า EC2

เข้า AWS Console แล้วไปที่:

```text
EC2 > Instances > share-ed-backend > Connect > Session Manager > Connect
```

เมื่อเข้าแล้ว ให้เริ่มทุกครั้งด้วย:

```bash
cd /opt/share-ed
```

## คำสั่งตรวจสอบประจำวัน (ไม่เปลี่ยนแปลงระบบ)

ตรวจ container ทั้งหมด:

```bash
docker compose ps
```

สถานะที่ควรเห็น:

- `backend` เป็น `Up ... (healthy)`
- `caddy` เป็น `Up`
- Caddy เปิด `80` และ `443`

ตรวจ health endpoint:

```bash
curl -i https://api.share-ed.online/
```

ตรวจ API และการเชื่อมต่อฐานข้อมูล:

```bash
curl -i https://api.share-ed.online/api/v1/categories
```

ดู log ล่าสุดของ backend:

```bash
docker compose logs --tail=100 backend
```

ดู log ล่าสุดของ Caddy/HTTPS:

```bash
docker compose logs --tail=100 caddy
```

ติดตาม log แบบสด (ออกด้วย `Ctrl+C`):

```bash
docker compose logs -f backend
docker compose logs -f caddy
```

ดูเฉพาะ error สำคัญของ Caddy:

```bash
docker compose logs caddy | grep -Ei 'error|certificate|challenge|acme|tls'
```

ตรวจว่า port 80/443 มีโปรแกรมรับการเชื่อมต่อ:

```bash
sudo ss -lntp | grep -E ':80|:443'
```

ตรวจพื้นที่ดิสก์:

```bash
df -h
docker system df
```

ตรวจ RAM และ load:

```bash
free -h
uptime
```

## ตรวจ DNS และ HTTPS

ตรวจว่า DNS ชี้ไป Elastic IP ปัจจุบัน:

```bash
getent ahostsv4 api.share-ed.online
```

ค่าที่คาดหวัง:

```text
54.251.195.223
```

ทดสอบ HTTPS พร้อม response headers:

```bash
curl -i https://api.share-ed.online/
```

ดูข้อมูล certificate:

```bash
echo | openssl s_client -connect api.share-ed.online:443 -servername api.share-ed.online 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

Caddy ต่ออายุ certificate อัตโนมัติ ข้อมูล certificate ถูกเก็บใน Docker volume `caddy_data` จึงไม่ควรลบ volume นี้

## ตรวจค่า Environment โดยไม่เปิดเผย Secret

ดูเฉพาะรายชื่อตัวแปร ไม่แสดงค่า:

```bash
grep -v '^[[:space:]]*#' .env | grep '=' | cut -d= -f1
```

ตรวจ permission ของ `.env`:

```bash
ls -l .env
```

ควรเป็นประมาณนี้:

```text
-rw-------
```

ตรวจจากใน container ว่าตัวแปรสำคัญมีค่าหรือไม่ โดยไม่แสดง secret:

```bash
docker compose exec backend node -e "console.log({DATABASE_URL:Boolean(process.env.DATABASE_URL),SUPABASE_URL:Boolean(process.env.SUPABASE_URL),SUPABASE_SECRET_KEY:Boolean(process.env.SUPABASE_SECRET_KEY)})"
```

ห้ามใช้ `cat .env` ในภาพหน้าจอ, log, issue หรือข้อความสาธารณะ

## ตรวจ Prisma migrations

ตรวจสถานะ migrations โดยใช้ direct/session database URL:

```bash
docker compose run --rm backend sh -c 'DATABASE_URL="$DIRECT_URL" npx prisma migrate status'
```

สถานะปกติควรลงท้ายด้วย:

```text
No pending migrations to apply.
```

นำ migration ที่มีอยู่แล้วไปใช้กับ production:

```bash
docker compose run --rm backend sh -c 'DATABASE_URL="$DIRECT_URL" npm run migrate:deploy'
```

คำสั่ง `migrate:deploy` ใช้ migration ที่ commit อยู่ใน repository เท่านั้น และไม่ควรใช้ `prisma migrate dev` บน production

## Deploy image ใหม่จาก ECR แบบ Manual

GitHub Actions ปัจจุบันทำหน้าที่ test, build และ push image เข้า ECR เมื่อ push branch `develop` ส่วนคำสั่งต่อไปนี้ใช้ดึง image ใหม่ลง EC2

เข้าสู่ระบบ ECR (token มีอายุจำกัด):

```bash
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin 997229934476.dkr.ecr.ap-southeast-1.amazonaws.com
```

ดึง image ใหม่:

```bash
docker compose pull backend
```

สร้าง backend container ใหม่จาก image ที่เพิ่งดึง โดยไม่ restart Caddy:

```bash
docker compose up -d --no-deps backend
```

ตรวจผลหลัง deploy:

```bash
docker compose ps
docker compose logs --tail=100 backend
curl -i https://api.share-ed.online/
curl -i https://api.share-ed.online/api/v1/categories
```

หมายเหตุ: `docker compose pull` อย่างเดียวไม่เปลี่ยน container ที่กำลังทำงาน ต้องตามด้วย `docker compose up -d --no-deps backend`

## คำสั่งที่เปลี่ยนสถานะระบบ

Restart เฉพาะ backend:

```bash
docker compose restart backend
```

Restart เฉพาะ Caddy:

```bash
docker compose restart caddy
```

สร้าง/อัปเดตทุก service ตาม `compose.yaml`:

```bash
docker compose up -d
```

หยุดระบบทั้งหมดโดยไม่ลบ volume:

```bash
docker compose down
```

เปิดระบบกลับมา:

```bash
docker compose up -d
```

หลีกเลี่ยง `docker compose down -v` เพราะ `-v` จะลบ volume รวมถึงข้อมูล certificate ของ Caddy

## ตรวจ Docker และระบบ EC2

```bash
docker --version
docker compose version
sudo systemctl status docker --no-pager
docker image ls
docker volume ls
docker network ls
```

ตรวจว่า EC2 ติดต่อ ECR ได้ผ่าน IAM role:

```bash
aws sts get-caller-identity
aws ecr describe-images --region ap-southeast-1 --repository-name share-ed-backend --max-items 5
```

## แก้ปัญหาที่พบบ่อย

### API ตอบ 502 Bad Gateway

ตรวจว่า backend healthy และดู log:

```bash
docker compose ps
docker compose logs --tail=150 backend
docker compose logs --tail=100 caddy
```

### HTTPS ใช้งานไม่ได้

ตรวจ DNS, port และ Caddy log:

```bash
getent ahostsv4 api.share-ed.online
sudo ss -lntp | grep -E ':80|:443'
docker compose logs --tail=150 caddy
```

ใน AWS Security Group ต้องอนุญาต inbound:

- TCP 80 จาก `0.0.0.0/0`
- TCP 443 จาก `0.0.0.0/0`

ไม่ต้องเปิด TCP 5000 สู่ Internet

### API ตอบ 500 หรือฐานข้อมูล timeout

```bash
docker compose logs --tail=150 backend
docker compose exec backend node --input-type=module -e "import pg from 'pg'; const c=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000}); try{await c.connect();console.log((await c.query('select 1 as ok')).rows);await c.end()}catch(e){console.error(e.message);process.exit(1)}"
```

ห้ามพิมพ์ `DATABASE_URL` ออกหน้าจอ เพราะมีรหัสผ่านฐานข้อมูล

### Image ใหม่ถูก push แล้ว แต่ EC2 ยังใช้โค้ดเก่า

```bash
docker compose pull backend
docker compose up -d --no-deps backend
docker compose ps
```

สาเหตุคือการ push เข้า ECR ไม่ได้เปลี่ยน container บน EC2 จนกว่าจะมีขั้น deploy การทำงานนี้จะถูกทำอัตโนมัติเมื่อเพิ่ม CD ผ่าน AWS Systems Manager (SSM)

## Frontend

Production API origin:

```text
https://api.share-ed.online
```

ถ้า frontend ต่อ endpoint เอง เช่น `/api/v1/categories` ให้ใช้ origin ด้านบน แต่ถ้า frontend เรียกเพียง `/categories` ให้ตั้ง base URL เป็น:

```text
https://api.share-ed.online/api/v1
```

Socket.IO ต้องเชื่อมที่ origin โดยไม่มี `/api/v1`:

```text
https://api.share-ed.online
```

## Checklist หลัง Deploy

- `docker compose ps` แสดง backend healthy
- `GET /` ได้ HTTP 200 และ `{"status":"ok"}`
- `GET /api/v1/categories` ได้ HTTP 200
- Frontend โหลดข้อมูลได้โดยไม่มี CORS error
- Login และ session ทำงาน
- Upload PDF/รูปภาพทำงาน
- Like/notification และ Socket.IO ทำงาน
- ตรวจ backend logs ว่าไม่มี error ใหม่
- ยังไม่ปิด Render จนกว่าจะทดสอบ production flow ครบ
