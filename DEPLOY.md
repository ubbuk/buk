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

Энэ нь `prisma/migrations` доторх 3 migration-ийг (мониторингийн индекс орно) хэрэглэнэ. **Хуучин өгөгдөл устахгүй**, зөвхөн нэмэлт.

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

## 5. Шалгах жагсаалт

- [ ] `https://<домэйн>/api/health` → `{"ok":true,"db":"up"}`
- [ ] Нэвтрэх хуудсанд demo жагсаалт **харагдахгүй**
- [ ] Захиалга үүсгэж, файл хавсаргаад татаж үзэх (S3)
- [ ] `/admin/monitoring` (ADMIN/DIRECTOR)
