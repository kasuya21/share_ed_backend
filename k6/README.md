# SHARE-ED k6 Load Testing Suite

ชุดทดสอบประสิทธิภาพและตรวจสอบการทำงานพร้อมกัน (Concurrency & Load Testing) ของระบบ SHARE-ED Backend ด้วย **Grafana k6**

---

## 📁 โครงสร้างชุดทดสอบ

```
k6/
├── README.md               # เอกสารคู่มือและการรัน
├── config/
│   └── env.js              # โหลดการตั้งค่า, Thresholds และ Load Profiles
├── helpers/
│   └── utils.js            # ยูทิลิตี้ช่วยเหลือ (UUID, Headers, Token selector)
├── scenarios/
│   ├── feed.js             # A. เปิดหน้าแรก/Feed และรายละเอียดโพสต์พร้อมกัน
│   ├── likes.js            # B. กดไลค์โพสต์เดียวกันพร้อมกัน
│   ├── rewards.js          # C. รับรางวัล/เคลมความสำเร็จพร้อมกัน
│   ├── notifications.js    # D. อ่านและเคลียร์การแจ้งเตือนพร้อมกัน
│   ├── posts-upload.js     # E. สร้างโพสต์และอัปโหลดพร้อมกัน
│   └── mixed.js            # F. โหลดผสมทุกกิจกรรม (Realistic Traffic Distribution)
├── fixtures/               # ข้อมูลทดสอบ (เช่น tokens, payloads)
└── results/                # ผลการรันสรุป (Summary JSON / Reports)
```

---

## 🛠️ ข้อกำหนดเบื้องต้น (Prerequisites)

1. ติดตั้ง **Grafana k6** (ติดตั้งแล้วที่ `C:\Program Files\k6\k6.exe` หรือผ่าน `winget install GrafanaLabs.k6`)
2. Backend กำลังทำงาน (เช่น `http://localhost:3000` หรือ Staging/Dev server)

---

## ⚙️ การตั้งค่า Environment Variables

ส่งค่าผ่าน Environment Variables หรือ Parameter `-e` ของ k6 โดยตรง:

```powershell
$env:BASE_URL="http://localhost:3000/api/v1"
$env:AUTH_TOKEN="<your-supabase-jwt-token>"
$env:TARGET_POST_ID="<optional-post-uuid>"
```

หรือใช้ flag `-e` ของ k6:
```powershell
& "C:\Program Files\k6\k6.exe" run -e BASE_URL="http://localhost:3000/api/v1" -e AUTH_TOKEN="xxx" k6/scenarios/feed.js
```

---

## 🚀 คำสั่งรันการทดสอบแต่ละ Scenario

### 1. ผู้ใช้เข้าเว็บและเปิด Feed พร้อมกัน (Feed & Post Details)
```powershell
# Smoke test (โหลดต่ำ ตรวจสอบความถูกต้อง)
& "C:\Program Files\k6\k6.exe" run -e PROFILE=smoke k6/scenarios/feed.js

# Load test (25 - 50 ผู้ใช้ต่อเนื่อง)
& "C:\Program Files\k6\k6.exe" run -e PROFILE=load k6/scenarios/feed.js

# Stress test (ไต่ระดับจนถึง 200 ผู้ใช้)
& "C:\Program Files\k6\k6.exe" run -e PROFILE=stress k6/scenarios/feed.js
```

### 2. กดไลค์โพสต์เดียวกันพร้อมกัน (Concurrent Likes)
```powershell
# Burst test (จำลอง 50 คำขอไลค์พร้อมกันทันที)
& "C:\Program Files\k6\k6.exe" run -e PROFILE=burst -e TARGET_POST_ID="<post-uuid>" k6/scenarios/likes.js
```

### 3. รับรางวัล / เคลมความสำเร็จพร้อมกัน (Achievement Rewards Claim)
```powershell
& "C:\Program Files\k6\k6.exe" run -e PROFILE=smoke k6/scenarios/rewards.js
```

### 4. ตรวจสอบการแจ้งเตือนพร้อมกัน (Notifications Load)
```powershell
& "C:\Program Files\k6\k6.exe" run -e PROFILE=load k6/scenarios/notifications.js
```

### 5. สร้างโพสต์และเปิด Session อัปโหลดพร้อมกัน (Post Creation & Upload)
```powershell
& "C:\Program Files\k6\k6.exe" run -e PROFILE=smoke k6/scenarios/posts-upload.js
```

### 6. โหลดผสมทุกกิจกรรม (Mixed Workload)
จำลองพฤติกรรมจริง: 60% อ่าน Feed, 20% ไลค์, 15% แจ้งเตือน, 5% สร้างโพสต์
```powershell
& "C:\Program Files\k6\k6.exe" run k6/scenarios/mixed.js
```

---

## 📊 เกณฑ์ผ่าน (Pass Criteria & Thresholds)

- **System Error Rate**: < 1% (`http_req_failed < 0.01`)
- **API Latency**:
  - API อ่าน / ไลค์ ทั่วไป: p95 < 500 ms และ p99 < 1,000 ms
  - API สร้างโพสต์ / อัปโหลด / รับรางวัล: p95 < 1,000 ms
- **Data Integrity**: ตรวจสอบว่าไม่มี Double Claiming (500 Error หรือแจกรางวัลซ้ำ), ยอดไลค์ไม่ติดลบ และ Idempotency ป้องกันการสร้างโพสต์ซ้ำได้ 100%
