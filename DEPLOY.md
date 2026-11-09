# Deploy: Vercel (app) + Aiven (PostgreSQL)

> Монгол хэлээр товч заавар. Командуудыг төслийн хавтаст ажиллуулна.

## 0. Мэдэх ёстой хязгаарлалт (Vercel = serverless)

| Зүйл | Vercel дээр | Шийдэл |
|---|---|---|
| Хавсралт файл | Диск түр зуурын тул хадгалагдахгүй | `STORAGE_DRIVER=s3` + хувийн S3-тэй нийцтэй bucket (AWS S3, Cloudflare R2). Aiven объект хадгалалт өгдөггүй. |
| Real-time (SSE) | Сигнал зөвхөн нэг instance дотор тархдаг, урт холболт таслагддаг | Автоматаар 20 секундийн polling руу шилжинэ (шууд биш). Жинхэнэ real-time-д Redis/Pusher/Ably хэрэгтэй (одоогоор нэмээгүй). |
| DB холболт | Instance бүр өөрийн pool нээнэ | `connection_limit=1` эсвэл Aiven connection pooling. |
| Нууц үг | Demo нууц үг `ubbuk2026` нийтийн кодод байдаг | Доорх 4-р алхмыг заавал хийх. |

Бүх зүйл (SSE, in-memory cache, local storage) нэг сервер (VPS/Docker) дээр өмнөх шигээ бүрэн ажиллана.

## 1. Aiven PostgreSQL

1. Aiven console → **Create service → PostgreSQL** (хувилбар 16).
2. **Connection information → Service URI** хуулна (`postgres://avnadmin:…@…aivencloud.com:PORT/defaultdb?sslmode=require`).
3. **Allowed IP addresses**: Vercel тогтмол IP өгөхгүй тул нээлттэй (`0.0.0.0/0`) байлгах эсвэл Vercel-ийн Static IPs (Pro) ашиглана. Нууц үг хүчтэй байх ёстой.
4. Миграцийг **өөрийн компьютероос** нэг удаа ажиллуулна (Vercel build-д биш):

```bash
DATABASE_URL="<Aiven Service URI>" npx prisma migrate deploy
```

Энэ нь `prisma/migrations` доторх бүх хүлээгдэж буй migration-ийг дарааллаар нь хэрэглэнэ. **Хуучин өгөгдөл устахгүй**, зөвхөн нэмэлт.

> **Vercel нь push бүрт автоматаар deploy хийдэг, харин `npm run build` migration ажиллуулдаггүй.** Схемийн өөрчлөлттэй кодыг production салбар руу push хийхээс **өмнө** миграцийг гараар ажиллуулсан байх ёстой (5b бүлэг).

## 2. S3-тэй нийцтэй bucket (хавсралтад)

Cloudflare R2 эсвэл AWS S3 дээр **private** bucket үүсгээд access key авна. Vercel-ийн environment variables-д `S3_*`-г оруулна (`.env.example`-г хар).

## 3. Vercel

1. GitHub repo-г Vercel-д import хийнэ (Framework: Next.js, Build command өөрчлөх шаардлагагүй: `npm run build` нь `prisma generate`-тэй).
2. **Environment Variables**:

| Нэр | Утга |
|---|---|
| `DATABASE_URL` | Aiven URI + `&connection_limit=1&pool_timeout=20` |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://<таны-төсөл>.vercel.app` |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT` | bucket-ийн мэдээлэл |

   `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS`-г **тохируулахгүй** (login дээрх demo жагсаалт, нууц үг нуугдана).
3. Deploy. Vercel-ийн Region-ийг Aiven-тэй ойр сонгоно (Settings → Functions → Region).

## 4. Эхний админ ба нууц үг (заавал)

Production DB-д demo нууц үгтэй хэрэглэгч үүсгэж **болохгүй**. Seed хийх бол:

```bash
SEED_PASSWORD="<урт санамсаргүй нууц үг>" DATABASE_URL="<Aiven URI>" npx prisma db seed
```

Дараа нь `admin@ubbuk.mn`-ээр нэвтэрч нууц үгээ (Тохиргоо → Нууц үг солих) болон бүх хэрэглэгчийн PIN-г тохируулна, шаардлагагүй demo хэрэглэгчдийг идэвхгүй болгоно. Seed нь demo хэлтэс, материал, агуулах үүсгэдэг тул жинхэнэ өгөгдлөөр солих хэрэгтэй.


## 4b. Demo-гүй цэвэр эхлэл (зөвлөмж болгосон)

Demo хэрэглэгчгүй эхлэхийн тулд `prisma/seed.ts`-ийн оронд `prisma/seed.production.ts`-ийг ашиглана. Энэ нь зөвхөн админ ба төв агуулахын нэг мөр үүсгэнэ.

**Aiven DB-г цэвэрлэх (БҮХ ӨГӨГДӨЛ УСТНА, зөвхөн туршилтын өгөгдөлтэй үед):**

1. Aiven → SQL editor → `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` ажиллуулна.
2. `DATABASE_URL="<Aiven URI>" npx prisma migrate deploy`
3. `SEED_PASSWORD="<12+ тэмдэгт>" DATABASE_URL="<Aiven URI>" npm run db:seed:prod`
4. `/login`-д `admin@ubbuk.mn` + тэр нууц үгээр нэвтэрч **Админ** хуудаснаас дарааллаар:
   1. Цех, тасаг үүсгэх,
   2. Хэрэглэгчид үүсгэх (зөв role-той, цэхэд оноох),
   3. Батлагчийн томилгоо: ENGINEERING_CHIEF, OPERATIONS_DIRECTOR, FINANCE_DIRECTOR, EXECUTIVE_DIRECTOR, STOREKEEPER_LEAD, CHIEF_ACCOUNTANT_LEAD (бүгд байхгүй бол захиалга үүсэхгүй),
   4. Цех бүрийн **Дарга**-г оноох,
   5. Хэрэглэгч бүр нэвтэрч нууц үгээ солиод, батлагч нар **PIN** тохируулна.

## 5b. Нэвтрэлтийн хурдны хязгаар, PIN-ийн аюулгүй байдал

**Migration `20261109120000_add_login_throttle` (нэг хүснэгт `LoginThrottle`, нэмэлт) кодоос ӨМНӨ** ажиллах ёстой: `npx prisma migrate deploy`. Нэвтрэлт болон нууц үг шалгах нь энэ хүснэгтээр хязгаарлагддаг бөгөөд хүснэгтгүй бол нэвтрэлт **хаалттай** (fail closed). Хуучин код шинэ хүснэгтийг үл тооцдог тул migration-ийг эхэлж хийх нь аюулгүй.

- **Нэвтрэлт:** акаунт × хаяг 5 буруу оролдлого, акаунтад нийт 20, нэг хаягаас нийт 200 (15 минут). Хязгаар хэтэрсэн оролдлого bcrypt-ээс өмнө татгалзагдана. Хугацаа өөрөө дуусна, хуучин мөрийг автоматаар цэвэрлэнэ.
- **`TRUSTED_PROXY`:** `X-Forwarded-For`-д зөвхөн итгэмжлэгдсэн proxy-тай үед л итгэнэ. Vercel дээр автоматаар (`VERCEL=1`), тохируулах шаардлагагүй. Өөр газар өөрийн nginx/load balancer-ийн ард бол `TRUSTED_PROXY=hops:1`. Тохируулаагүй бол IP-ээр хязгаарлахгүй, зөвхөн акаунтаар. Буруу `hops` утга хуурамч header-ээр хязгаарыг тойрох боломж олгоно.
- **PIN:** PIN тохируулах/солиход **нууц үг заавал**. Түгжигдсэн акаунт PIN солиж чадахгүй (түгжилтийг цэвэрлэхгүй). 5 буруу PIN → 15 минутын түгжилт (атомик тоолуур).
- **Админ PIN цуцлах:** шалтгаан, "ажилтны хувийн байдлыг баталгаажуулсан" тэмдэглэгээ, админы өөрийн нууц үг заавал. Админ PIN-ийг харахгүй, сонгохгүй. Админ өөрийн PIN-ийг цуцалж чадахгүй. Админ тус бүр 20, ажилтан тус бүр 3 удаа / 15 минут. Аудитад `RESET_CREDENTIALS` (`kind: PIN_RESET`, шалтгаан, actor, target) бичигдэнэ.
- **Хувийн профайл (`/profile`):** нэвтэрсэн ажилтан зөвхөн өөрийн профайлыг харна (ADMIN ч гэсэн). Id параметр байхгүй.
- **Мэдэгдэж буй эрсдэл:** `reset-credentials` (нууц үг сэргээх) ADMIN-д түр нууц үгийг буцаадаг. ADMIN тэр нууц үгээр ажилтнаар нэвтэрч PIN үүсгэх боломжтой тул PIN цуцлалтын хамгаалалтыг тойрно. Энэ release-д өөрчлөөгүй.

**Rollback:** кодыг Vercel-ийн өмнөх deployment руу буцаана. `LoginThrottle` хүснэгт үлдэнэ, хуучин код үүнийг үл тооцно, өгөгдөл алдагдахгүй. Хүснэгтийг устгах шаардлагагүй.

## 5. Шалгах жагсаалт

- [ ] `https://<домэйн>/api/health` → `{"ok":true,"db":"up"}`
- [ ] Нэвтрэх хуудсанд demo жагсаалт **харагдахгүй**
- [ ] Захиалга үүсгэж, файл хавсаргаад татаж үзэх (S3)
- [ ] `/admin/monitoring` (ADMIN/DIRECTOR)
