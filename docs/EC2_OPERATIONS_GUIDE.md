# คู่มือดูแล Share-Ed Backend บน AWS EC2

> คู่มือนี้เขียนสำหรับผู้เริ่มต้น ใช้ตรวจสอบและแก้ปัญหา Share-Ed Backend ที่รันด้วย Docker Compose บน Amazon EC2

## สารบัญ

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [สิ่งที่ควรเข้าใจก่อนเริ่ม](#2-สิ่งที่ควรเข้าใจก่อนเริ่ม)
3. [การเข้า EC2 ด้วย Session Manager](#3-การเข้า-ec2-ด้วย-session-manager)
4. [คำสั่ง Linux พื้นฐาน](#4-คำสั่ง-linux-พื้นฐาน)
5. [คำสั่งตรวจสุขภาพเครื่อง](#5-คำสั่งตรวจสุขภาพเครื่อง)
6. [พื้นฐาน Docker และ Docker Compose](#6-พื้นฐาน-docker-และ-docker-compose)
7. [ขั้นตอนตรวจระบบประจำวัน](#7-ขั้นตอนตรวจระบบประจำวัน)
8. [การอ่าน Logs และตามหา Error](#8-การอ่าน-logs-และตามหา-error)
9. [การตรวจ API, DNS และ HTTPS](#9-การตรวจ-api-dns-และ-https)
10. [การตรวจฐานข้อมูลและ Prisma Migration](#10-การตรวจฐานข้อมูลและ-prisma-migration)
11. [การ Deploy](#11-การ-deploy)
12. [แนวทางแก้ปัญหาตามอาการ](#12-แนวทางแก้ปัญหาตามอาการ)
13. [คำสั่ง AWS CLI จากเครื่องส่วนตัว](#13-คำสั่ง-aws-cli-จากเครื่องส่วนตัว)
14. [ข้อควรระวัง](#14-ข้อควรระวัง)
15. [Checklist ฉุกเฉิน](#15-checklist-ฉุกเฉิน)

---

## 1. ภาพรวมระบบ

```text
ผู้ใช้งาน
   │
   ▼
Frontend: https://share-ed.online
   │
   ▼
DNS: api.share-ed.online → Elastic IP ของ EC2
   │
   ▼
Caddy บน EC2 (รับ HTTP/HTTPS ที่ port 80/443)
   │
   ▼
Backend container (Node.js, port 5000 ภายใน Docker network)
   │
   ├── Supabase PostgreSQL
   ├── Supabase Auth
   └── Supabase Storage
```

ส่วนประกอบสำคัญ:

| ส่วน | หน้าที่ | อยู่ที่ไหน |
|---|---|---|
| Source code | โค้ด Backend, Dockerfile, migrations และ workflow | GitHub |
| ECR | เก็บ Docker image ที่ build แล้ว | AWS ECR |
| EC2 | เครื่องที่รัน Backend และ Caddy | AWS EC2 |
| EBS | ดิสก์ของ EC2 | AWS EBS |
| Caddy | HTTPS และ reverse proxy | Docker บน EC2 |
| Database/Auth/Storage | ข้อมูลผู้ใช้ โพสต์ และไฟล์ | Supabase |
| CI/CD | Test, build, push และ deploy อัตโนมัติ | GitHub Actions |
| Monitoring | ตรวจ API ตามเวลา | Lambda + EventBridge |
| Alert | ส่งแจ้งเตือนเมื่อผิดปกติ | Discord webhook |
| Logs | Log ของ Lambda และบริการ AWS | CloudWatch |

ค่าที่ใช้ใน Production:

| รายการ | ค่า |
|---|---|
| AWS Region | `ap-southeast-1` (Singapore) |
| EC2 instance ID | `i-01eba95087ad96485` |
| โฟลเดอร์ระบบบน EC2 | `/opt/share-ed` |
| Production API | `https://api.share-ed.online` |
| Git branch สำหรับ Production | `develop` |
| ECR repository | `share-ed-backend` |

> Port `5000` ไม่เปิดสู่ Internet โดยตรง ผู้ใช้เข้าผ่าน Caddy ที่ port `443` เท่านั้น

---

## 2. สิ่งที่ควรเข้าใจก่อนเริ่ม

### 2.1 Terminal สองแบบที่ไม่เหมือนกัน

```text
PS C:\...>  = PowerShell บนคอมพิวเตอร์ของเรา
sh-5.2$     = Linux shell ภายใน EC2
```

อย่านำคำสั่ง PowerShell เช่น `notepad` ไปใช้ใน EC2 และอย่านำคำสั่ง Linux บางคำสั่งไปใช้ใน PowerShell โดยไม่ตรวจสอบก่อน

### 2.2 Docker image กับ container

```text
Dockerfile → Build → Image → Run → Container
```

- **Dockerfile**: สูตรสำหรับสร้างแอป
- **Image**: ชุดไฟล์ของแอปที่ build เสร็จแล้ว
- **Container**: Image ที่กำลังทำงาน
- **Docker Compose**: ตัวจัดการหลาย container เช่น `backend` และ `caddy`
- **Volume**: พื้นที่เก็บข้อมูลที่ต้องอยู่ต่อแม้สร้าง container ใหม่
- **Network**: เครือข่ายภายในที่ให้ Caddy ติดต่อ Backend

การ push image ใหม่เข้า ECR **ไม่ได้เปลี่ยน container ที่กำลังทำงานทันที** ต้องมีขั้นตอน pull และ recreate container ซึ่งระบบ CI/CD ทำให้อัตโนมัติ

### 2.3 ไฟล์สำคัญบน EC2

```text
/opt/share-ed/
├── .env          # Secret และค่าตั้ง Production
├── compose.yaml  # กำหนด backend และ caddy
├── Caddyfile     # กำหนด HTTPS และ reverse proxy
└── deploy.sh     # สคริปต์ deploy ที่ GitHub Actions เรียกผ่าน SSM
```

ไฟล์เหล่านี้อยู่บน EC2 และไม่ควรเปิดเผยต่อสาธารณะ โดยเฉพาะ `.env`

> `compose.yaml` ใน repository ใช้สำหรับ Local Development ส่วน Production compose อยู่ที่ `/opt/share-ed/compose.yaml` บน EC2

---

## 3. การเข้า EC2 ด้วย Session Manager

### ผ่าน AWS Console

```text
EC2
→ Instances
→ เลือก share-ed-backend
→ Connect
→ Session Manager
→ Connect
```

Session Manager ปลอดภัยกว่าเปิด SSH สู่ Internet เพราะไม่จำเป็นต้องเปิด port `22`

เมื่อเข้าแล้ว ให้เริ่มด้วย:

```bash
whoami
cd /opt/share-ed
pwd
```

ค่าที่ควรได้:

```text
whoami → ssm-user
pwd    → /opt/share-ed
```

ออกจาก Session:

```bash
exit
```

---

## 4. คำสั่ง Linux พื้นฐาน

### ดูตำแหน่งและไฟล์

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `pwd` | ดูว่าตอนนี้อยู่โฟลเดอร์ไหน |
| `ls` | ดูรายชื่อไฟล์ |
| `ls -la` | ดูไฟล์ทั้งหมด รวมไฟล์ซ่อนและ permission |
| `cd /opt/share-ed` | เข้าโฟลเดอร์ Production |
| `cd ..` | ย้อนกลับหนึ่งระดับ |
| `cd` | กลับ home ของผู้ใช้ |

### อ่านไฟล์โดยไม่แก้ไข

```bash
less ชื่อไฟล์
```

- กดลูกศรหรือ Page Up/Page Down เพื่อเลื่อน
- กด `/` แล้วพิมพ์คำเพื่อค้นหา
- กด `q` เพื่อออก

ดูบรรทัดแรกหรือท้ายไฟล์:

```bash
head -n 20 ชื่อไฟล์
tail -n 20 ชื่อไฟล์
```

### คำสั่งช่วยเหลือ

```bash
history
clear
คำสั่ง --help
```

ถ้าคำสั่งกำลังทำงานต่อเนื่อง เช่นการดู log ให้กด:

```text
Ctrl+C
```

`Ctrl+C` ในกรณีนี้หยุดคำสั่งที่กำลังดูอยู่ ไม่ได้หยุด container

---

## 5. คำสั่งตรวจสุขภาพเครื่อง

### ดูเวลาเปิดเครื่องและภาระงาน

```bash
uptime
```

ตัวเลข `load average` สูงต่อเนื่องอาจหมายถึง CPU หรือระบบกำลังทำงานหนัก

### ดู RAM

```bash
free -h
```

Linux ใช้ RAM ว่างเป็น cache ได้ จึงควรดูค่า `available` มากกว่าดูเฉพาะ `free`

### ดูพื้นที่ดิสก์

```bash
df -h
```

ให้ดูแถวที่ mount อยู่ที่ `/`:

- ต่ำกว่า 70%: ปกติ
- 70–85%: ควรเริ่มตรวจ
- มากกว่า 85%: ควรจัดการก่อนดิสก์เต็ม

ดูว่า Docker ใช้พื้นที่เท่าไร:

```bash
docker system df
```

### ดู process แบบสด

```bash
top
```

กด `q` เพื่อออก

---

## 6. พื้นฐาน Docker และ Docker Compose

ทุกคำสั่งในส่วนนี้ให้เริ่มจาก:

```bash
cd /opt/share-ed
```

### ดูสถานะ container

```bash
docker compose ps
```

สถานะปกติ:

- `backend` เป็น `Up ... (healthy)`
- `caddy` เป็น `Up`
- Caddy เปิด port `80` และ `443`

### ดู container ทั้งเครื่อง

```bash
docker ps
docker ps -a
```

- `docker ps` แสดงเฉพาะ container ที่ทำงาน
- `docker ps -a` แสดง container ที่หยุดหรือพังด้วย

### ดู CPU และ RAM ของ container

```bash
docker stats --no-stream
```

### ดู images

```bash
docker image ls
```

### ตรวจ Docker service

```bash
sudo systemctl status docker --no-pager
```

ถ้า Docker หยุดทำงาน:

```bash
sudo systemctl restart docker
cd /opt/share-ed
docker compose up -d
```

จากนั้นตรวจอีกครั้ง:

```bash
docker compose ps
```

### Restart เฉพาะบริการ

```bash
docker compose restart backend
docker compose restart caddy
```

ใช้เมื่อ service ยังอยู่แต่ทำงานผิดปกติ และตรวจ log ก่อน restart เสมอ

---

## 7. ขั้นตอนตรวจระบบประจำวัน

รันตามลำดับนี้:

```bash
whoami
cd /opt/share-ed
docker compose ps
docker stats --no-stream
df -h
free -h
docker compose logs --tail=50 backend
curl -s -o /dev/null -w '%{http_code}\n' https://api.share-ed.online/
curl -s -o /dev/null -w '%{http_code}\n' https://api.share-ed.online/api/v1/categories
```

ผลที่ควรเห็น:

| จุดตรวจ | ผลปกติ |
|---|---|
| Backend container | `healthy` |
| Caddy container | `Up` |
| Disk | ไม่ใกล้ 100% |
| Root API | HTTP `200` |
| Categories API | HTTP `200` |
| Backend logs | ไม่มี error ใหม่ต่อเนื่อง |

ถ้าทุกข้อผ่าน ระบบหลักทำงานปกติ

---

## 8. การอ่าน Logs และตามหา Error

### Backend logs ล่าสุด

```bash
docker compose logs --tail=100 backend
```

### Caddy และ HTTPS logs

```bash
docker compose logs --tail=100 caddy
```

### ดู log แบบสด

```bash
docker compose logs -f --tail=50 backend
```

ออกด้วย `Ctrl+C`

### ค้นหา error

```bash
docker compose logs backend | grep -Ei 'error|failed|exception'
```

### ค้นหาจาก X-Request-ID

เมื่อ API ตอบ error ให้ดู header `X-Request-ID` จาก Browser DevTools แล้วค้นหา:

```bash
docker compose logs backend | grep 'ใส่-request-id-ตรงนี้'
```

ตัวอย่าง:

```bash
docker compose logs backend | grep '4ee124fe-42ab-4bdc-8844-09b424aa6fbf'
```

วิธีคิดเมื่ออ่าน log:

1. ดู `event` ว่า error เกิดที่ส่วนใด
2. ดู `route` ว่าเป็น API เส้นไหน
3. ดู `status` และ `error.code`
4. ใช้ `requestId` รวมเหตุการณ์ของ request เดียวกัน
5. แก้สาเหตุ ไม่ควร restart อย่างเดียวโดยไม่อ่าน log

---

## 9. การตรวจ API, DNS และ HTTPS

### ตรวจ Root API

```bash
curl -i https://api.share-ed.online/
```

ควรได้:

```text
HTTP/2 200
{"status":"ok"}
```

### ตรวจ API ที่แตะฐานข้อมูล

```bash
curl -i https://api.share-ed.online/api/v1/categories
```

หาก Root API ผ่าน แต่ Categories ล้ม มีโอกาสเป็นปัญหาฐานข้อมูลหรือ Prisma

### ตรวจ DNS

```bash
getent ahostsv4 api.share-ed.online
```

ควรชี้ไป Elastic IP ปัจจุบันของ EC2

### ตรวจ port

```bash
sudo ss -lntp | grep -E ':80|:443'
```

### ตรวจใบรับรอง HTTPS

```bash
echo | openssl s_client -connect api.share-ed.online:443 -servername api.share-ed.online 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

ถ้า HTTPS มีปัญหา ให้ตรวจตามลำดับ:

1. DNS ชี้ Elastic IP ถูกหรือไม่
2. Security Group เปิด TCP `80` และ `443` หรือไม่
3. Caddy container ทำงานหรือไม่
4. Caddy log มี ACME/TLS error หรือไม่

```bash
docker compose ps
docker compose logs caddy | grep -Ei 'error|certificate|challenge|acme|tls'
```

---

## 10. การตรวจฐานข้อมูลและ Prisma Migration

### Migration คืออะไร

```text
schema.prisma = ฐานข้อมูลควรมีโครงสร้างอย่างไร
migration.sql = ขั้นตอนเปลี่ยนฐานข้อมูลเดิมไปเป็นโครงสร้างใหม่
ฐานข้อมูลจริง = ผลลัพธ์หลังนำ migration ไปใช้
```

Migration ทำให้ฐานข้อมูลของนักพัฒนา, CI และ Production มีโครงสร้างตรงกัน

### ตรวจสถานะ Migration

```bash
cd /opt/share-ed
docker compose run --rm backend sh -c 'DATABASE_URL="$DIRECT_URL" npx prisma migrate status'
```

สถานะปกติ:

```text
No pending migrations to apply.
```

### นำ Migration ใหม่ไปใช้

ปกติ `deploy.sh` ทำขั้นตอนนี้อัตโนมัติ หากจำเป็นต้องตรวจหรือ deploy ด้วยตนเอง:

```bash
docker compose run --rm backend sh -c 'DATABASE_URL="$DIRECT_URL" npm run migrate:deploy'
```

ห้ามใช้คำสั่งต่อไปนี้ใน Production:

```bash
npx prisma migrate reset
npx prisma migrate dev
```

`migrate reset` สามารถลบข้อมูลในฐานข้อมูลได้

### อาการที่มักเกี่ยวกับฐานข้อมูล

| Error | ความหมายเบื้องต้น | จุดที่ควรตรวจ |
|---|---|---|
| `P2022` | โค้ดต้องการ column ที่ฐานข้อมูลยังไม่มี | Migration และ `schema.prisma` |
| Connection timeout | ต่อฐานข้อมูลไม่ได้ | `DATABASE_URL`, Supabase และ network |
| No pending migrations | Migration ถูกใช้ครบแล้ว | ไม่ต้องทำเพิ่ม |

---

## 11. การ Deploy

### วิธีปกติ: GitHub Actions

```text
Push เข้า branch develop
→ Run tests
→ Build Docker image
→ Push image เข้า ECR
→ ส่งคำสั่งไป EC2 ผ่าน SSM
→ รัน deploy.sh
→ Apply migrations
→ สร้าง backend container ใหม่
→ ตรวจ health
```

ตรวจ Workflow ที่ GitHub:

```text
Repository → Actions → Test, Build and Push Backend
```

### ตรวจหลัง Deploy

```bash
cd /opt/share-ed
docker compose ps
docker compose logs --tail=100 backend
curl -i https://api.share-ed.online/
curl -i https://api.share-ed.online/api/v1/categories
```

### Deploy ด้วยตนเองเมื่อ CI/CD ใช้งานไม่ได้

ใช้เฉพาะเมื่อเข้าใจผลกระทบ:

```bash
cd /opt/share-ed
./deploy.sh
```

หรือรันทีละขั้น:

```bash
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin 997229934476.dkr.ecr.ap-southeast-1.amazonaws.com
docker compose pull backend
docker compose run --rm backend sh -c 'DATABASE_URL="$DIRECT_URL" npm run migrate:deploy'
docker compose up -d --no-deps backend
docker compose ps
```

> `docker compose pull` อย่างเดียวไม่เปลี่ยน container ที่กำลังทำงาน ต้องมี `docker compose up -d --no-deps backend` ตามหลัง

---

## 12. แนวทางแก้ปัญหาตามอาการ

### 12.1 เว็บไซต์หรือ API เข้าไม่ได้ทั้งหมด

ตรวจจากนอกระบบก่อน:

```bash
curl -i https://api.share-ed.online/
```

จากนั้นตรวจ:

```bash
cd /opt/share-ed
docker compose ps
docker compose logs --tail=100 caddy
docker compose logs --tail=100 backend
df -h
```

จุดที่อาจเสีย:

| ผลตรวจ | จุดที่ควรแก้ |
|---|---|
| EC2 หยุด | AWS EC2 |
| DNS ผิด IP | ผู้ให้บริการ DNS |
| Caddy หยุด | `/opt/share-ed/compose.yaml` และ Caddy logs |
| Backend หยุด | Backend logs และ `.env` |
| Disk เต็ม | Docker images/logs หรือไฟล์บน EBS |

### 12.2 API ตอบ `502 Bad Gateway`

ความหมาย: Caddy ทำงาน แต่ติดต่อ Backend ไม่ได้

```bash
cd /opt/share-ed
docker compose ps
docker compose logs --tail=150 backend
docker compose logs --tail=100 caddy
```

ถ้า Backend หยุดหรือ unhealthy:

```bash
docker compose up -d --no-deps backend
docker compose ps
```

ถ้ายังไม่หาย ให้แก้สาเหตุจาก Backend log ก่อน restart ซ้ำ

### 12.3 API ตอบ `500 Internal Server Error`

ความหมาย: Request ถึง Backend แล้ว แต่โค้ดหรือบริการภายในเกิด error

1. คัดลอก `X-Request-ID` จาก response
2. ค้นหาใน Backend log

```bash
docker compose logs backend | grep 'ใส่-request-id'
```

ตรวจ `error.code`:

- Prisma error → ตรวจ migration/schema/database
- Auth error → ตรวจ Supabase Auth และ environment variables
- Storage error → ตรวจ Supabase Storage bucket และสิทธิ์
- Validation error → ตรวจข้อมูลที่ Frontend ส่ง

### 12.4 API ตอบ `401 Unauthorized`

ตรวจ:

- Frontend ส่ง `Authorization: Bearer <token>` หรือไม่
- Token หมดอายุหรือไม่
- Frontend และ Backend ใช้ Supabase project เดียวกันหรือไม่
- เวลาเครื่องถูกต้องหรือไม่

```bash
date
```

อย่านำ token จริงไปวางใน issue, Git หรือข้อความสาธารณะ

### 12.5 API ตอบ `404 Not Found`

ตรวจ path ก่อน ตัวอย่างที่ถูกต้อง:

```text
https://api.share-ed.online/api/v1/categories
```

ไม่ใช่:

```text
https://api.share-ed.online/categories
```

Frontend REST API ต้องมี `/api/v1` เพียงหนึ่งครั้ง ส่วน Socket.IO ใช้ origin โดยไม่มี `/api/v1`

### 12.6 HTTPS หรือ Certificate มีปัญหา

```bash
getent ahostsv4 api.share-ed.online
sudo ss -lntp | grep -E ':80|:443'
docker compose logs --tail=150 caddy
```

Security Group ต้องมี:

- TCP 80 จาก `0.0.0.0/0`
- TCP 443 จาก `0.0.0.0/0`

ไม่ต้องเปิด port `5000` สู่ Internet

ห้ามลบ Docker volume `caddy_data` โดยไม่จำเป็น เพราะเก็บข้อมูล certificate ของ Caddy

### 12.7 Image ใหม่ขึ้น ECR แล้ว แต่ EC2 ยังเป็นโค้ดเก่า

ตรวจ GitHub Actions ก่อน หาก workflow ผ่านแต่ยังเป็นโค้ดเก่า:

```bash
cd /opt/share-ed
docker compose pull backend
docker compose up -d --no-deps backend
docker compose ps
```

### 12.8 Backend restart ซ้ำหรือ unhealthy

```bash
docker compose ps
docker compose logs --tail=200 backend
docker inspect --format='{{json .State.Health}}' share-ed-backend-1
```

สาเหตุที่พบบ่อย:

- Environment variable หาย
- ต่อฐานข้อมูลไม่ได้
- Migration ยังไม่ถูกใช้
- Application crash ตอนเริ่มทำงาน
- Health check path ผิด

### 12.9 ดิสก์ใกล้เต็ม

ตรวจอย่างเดียวก่อน:

```bash
df -h
docker system df
docker image ls
```

อย่ารีบรัน `docker system prune -a` เพราะอาจลบ images ที่ต้องใช้ rollback ควรระบุสิ่งที่จะลบให้ชัดเจนก่อน

---

## 13. คำสั่ง AWS CLI จากเครื่องส่วนตัว

ส่วนนี้รันใน **PowerShell บนเครื่องส่วนตัว** ไม่ใช่ใน EC2

### ตั้ง Profile สำหรับหน้าต่างปัจจุบัน

```powershell
$env:AWS_PROFILE = "share-ed"
$env:AWS_REGION = "ap-southeast-1"
```

ถ้า session หมดอายุ:

```powershell
aws sso login --profile share-ed
```

### ตรวจตัวตน

```powershell
aws sts get-caller-identity
```

### ดู EC2

```powershell
aws ec2 describe-instances `
  --query "Reservations[].Instances[].{Name:Tags[?Key=='Name']|[0].Value,ID:InstanceId,State:State.Name,PublicIP:PublicIpAddress}" `
  --output table
```

### เข้า EC2 จาก PowerShell

ต้องติดตั้ง Session Manager Plugin ก่อน:

```powershell
aws ssm start-session --target i-01eba95087ad96485
```

### ดู Lambda monitor

```powershell
aws lambda get-function-configuration `
  --function-name share-ed-api-monitor `
  --query "{Name:FunctionName,Runtime:Runtime,Timeout:Timeout,Updated:LastModified}" `
  --output table
```

### ดูตารางตรวจระบบ

```powershell
aws scheduler list-schedules `
  --query "Schedules[].{Name:Name,State:State,Schedule:ScheduleExpression}" `
  --output table
```

### ดู ECR images

```powershell
aws ecr describe-images `
  --repository-name share-ed-backend `
  --query "sort_by(imageDetails,&imagePushedAt)[].{Tags:imageTags,Pushed:imagePushedAt,Size:imageSizeInBytes}" `
  --output table
```

คำสั่งที่ขึ้นต้นด้วย `describe`, `get` และ `list` มักเป็นการอ่านข้อมูล ส่วน `delete`, `terminate`, `put`, `update` และ `remove` สามารถเปลี่ยนระบบจริงได้

---

## 14. ข้อควรระวัง

### ห้ามเปิดเผย Secret

ห้ามนำสิ่งเหล่านี้ขึ้น GitHub หรือส่งในภาพหน้าจอ:

- `.env`
- Database URL และรหัสผ่าน
- Supabase secret/service-role key
- Access token/JWT
- Discord webhook URL
- AWS access key/secret key

ดูเฉพาะชื่อตัวแปรใน `.env` โดยไม่แสดงค่า:

```bash
grep -v '^[[:space:]]*#' .env | grep '=' | cut -d= -f1
```

ตรวจ permission:

```bash
ls -l .env
```

ควรเป็น:

```text
-rw-------
```

### คำสั่งอันตราย

อย่ารันโดยไม่เข้าใจผลกระทบ:

```bash
rm -rf
docker compose down -v
docker system prune -a
npx prisma migrate reset
```

ผลกระทบที่เป็นไปได้:

| คำสั่ง | ความเสี่ยง |
|---|---|
| `rm -rf` | ลบไฟล์และโฟลเดอร์ถาวร |
| `docker compose down -v` | ลบ container, network และ volumes |
| `docker system prune -a` | ลบ images ที่ไม่ได้ใช้งาน รวม image สำหรับ rollback |
| `prisma migrate reset` | ล้างข้อมูลฐานข้อมูล |

### ก่อนเปลี่ยนระบบทุกครั้ง

1. อ่าน log และระบุสาเหตุ
2. ตรวจว่าอยู่เครื่องและโฟลเดอร์ถูกต้อง
3. ตรวจคำสั่งว่ามีผลกับ service ใด
4. เก็บผลลัพธ์ก่อนแก้ เพื่อเปรียบเทียบหลังแก้
5. ตรวจ API หลังเปลี่ยนทุกครั้ง

---

## 15. Checklist ฉุกเฉิน

เมื่อได้รับแจ้งว่า “ระบบใช้ไม่ได้” ให้ทำตามนี้ทีละข้อ:

```bash
# 1. เข้าโฟลเดอร์ Production
cd /opt/share-ed

# 2. ตรวจ container
docker compose ps

# 3. ตรวจทรัพยากรเครื่อง
df -h
free -h
uptime

# 4. ตรวจ Backend และ Caddy logs
docker compose logs --tail=150 backend
docker compose logs --tail=100 caddy

# 5. ตรวจ API
curl -i https://api.share-ed.online/
curl -i https://api.share-ed.online/api/v1/categories

# 6. ตรวจ DNS
getent ahostsv4 api.share-ed.online
```

ตารางตัดสินใจอย่างย่อ:

| อาการ | จุดตรวจแรก | จุดที่มักต้องแก้ |
|---|---|---|
| Domain เข้าไม่ได้ | DNS, EC2, Caddy | DNS/Security Group/Caddy |
| `502` | Backend container | Backend startup/logs/config |
| `500` | X-Request-ID | Controller/Prisma/Supabase |
| `401` | Authorization header | Frontend token/Auth config |
| `404` | URL path | Frontend base URL/routes |
| HTTPS error | Caddy logs/DNS | Certificate/DNS/port 80–443 |
| Deploy ไม่อัปเดต | GitHub Actions/ECR | CI/CD, image pull, recreate |
| EC2 ช้า | CPU/RAM/Disk | Process, logs, Docker storage |

หลังแก้ไขต้องตรวจอย่างน้อย:

```bash
docker compose ps
docker compose logs --tail=50 backend
curl -s -o /dev/null -w '%{http_code}\n' https://api.share-ed.online/
curl -s -o /dev/null -w '%{http_code}\n' https://api.share-ed.online/api/v1/categories
```

ทั้งสอง API ควรตอบ `200` และ Backend ควรเป็น `healthy`

---

## สรุปลำดับการเรียนรู้

สำหรับผู้เริ่มต้น แนะนำให้เรียนตามลำดับ:

1. **Linux พื้นฐาน** — `pwd`, `ls`, `cd`, `less`, `grep`, `tail`
2. **ตรวจสุขภาพเครื่อง** — `uptime`, `free -h`, `df -h`, `top`
3. **Docker พื้นฐาน** — image, container, volume และ network
4. **Docker Compose** — `ps`, `logs`, `up`, `restart`, `pull`
5. **HTTP และ Networking** — status code, DNS, ports และ HTTPS
6. **Logs และ Request ID** — ตามหา error ให้เจอก่อนแก้
7. **Prisma Migration** — ทำให้ schema ของโค้ดตรงกับฐานข้อมูล
8. **CI/CD** — GitHub Actions → ECR → SSM → EC2
9. **AWS CLI** — ตรวจและจัดการ AWS จากเครื่องส่วนตัว
10. **Monitoring** — Lambda, EventBridge, CloudWatch และ Discord

หลักสำคัญที่สุดคือ **ตรวจสถานะ → อ่าน log → ระบุสาเหตุ → แก้เฉพาะจุด → ทดสอบซ้ำ** ไม่ควร restart หรือลบสิ่งต่าง ๆ แบบเดาสุ่ม
