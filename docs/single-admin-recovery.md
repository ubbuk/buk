# Ганц ADMIN-тай ERP: break-glass сэргээх журам ба production release бэлтгэл

Статус: **төлөвлөгөө, баримтжуулалт. Production-д ямар ч шалгалт, өөрчлөлт хийгдээгүй.** Энэ баримтад бичсэн production-ийн баримтууд (ганц идэвхтэй ADMIN, `defaultdb`, 5 дууссан migration, Aiven автомат backup) нь хэрэглэгчийн өөрийн мэдээлсэн зүйл; би шалгаагүй. Кодын тухай баримтууд (JWT, session, migration SQL) нь `release/profile-security` (`f518643`) дээр шалгагдсан.

Шийдвэр: байгууллага **зөвхөн нэг ADMIN**-тай хэвээр үлдэнэ. Хоёр дахь ADMIN үүсгэхгүй. Иймд "нэг админ нөгөөгөө сэргээнэ" гэсэн замгүй, сэргээх нь аппаас гадуурх **break-glass** журмаар хийгдэнэ.

---

## 1. Шударга эхлэл: энэ журам юуг шийдэхгүй вэ

- Break-glass нь **ADMIN impersonation эрсдэлийг шийдэхгүй** (§7). Ганц админы акаунт эвдэрвэл системийн бүх эрх эвдэрнэ.
- Хоёр хүний зөвшөөрөл, хугацааны хязгаар, мэдэгдэл нь **байгууллагын журам + гараар бичсэн SQL** юм. Програм үүнийг мөрдүүлдэггүй, зөрчихөд зогсоодоггүй.
- Aiven дахь database-ийн эзэн (operator) өгөгдлийн санг шууд өөрчилж чадна. Тэр хүн ADMIN өөрөө бол хоёр хүний зарчим үгүй болно. **Operator нь ADMIN-аас өөр хүн байх ёстой**, эс бөгөөс энэ журам зөвхөн бичигдсэн бүртгэл үлдээнэ, хяналт болохгүй.

## 2. Журмын зарчим (ямар ч тохиолдолд мөрдөнө)

1. ADMIN эрхийг **бусдад олгохгүй**. Хоёр дахь ADMIN үүсэхгүй, ямар ч role өөрчлөгдөхгүй.
2. Зөвхөн **нэг мөр өөрчилнө**: ганц ADMIN-ийн `User.passwordHash`. `ApprovalStep`, `ApprovalAction`, `ApprovalRoleAssignment`, `ApprovalPinCredential`, `ProcurementPurchase`, одоо байгаа `AuditLog` мөрүүдэд **хүрэхгүй**.
3. PIN-ийг **тойрохгүй**: PIN тохируулахгүй, харахгүй. (Ганц ADMIN нь батлах албан тушаалгүй тул PIN-гүй гэж үзнэ; албан тушаалтай бол §3.4.)
4. Үйлдэл бүр **шинэ audit мөр** үлдээнэ (`RESET_CREDENTIALS`, `kind: BREAK_GLASS_RECOVERY`), хуучин мөрийг засахгүй.
5. Админд болон гүйцэтгэх захиралд **мэдэгдэл** үлдээнэ.
6. Зөвшөөрөл **24 цагийн дотор** хүчинтэй. Хугацаа хэтэрвэл шинэ хүсэлт.
7. Operator нууц үгийг **мэдэхгүй**: ADMIN өөрөө нууц үгээ сонгоод зөвхөн bcrypt hash-ийг өгнө.

## 3. Break-glass журам

### 3.1 Хэзээ хэрэглэх вэ

| Нөхцөл | Хэрэгтэй арга |
| --- | --- |
| Нууц үгээ мартсан, одоо ч нэвтэрсэн төхөөрөмж байгаа | Break-glass **хэрэггүй**: Тохиргоо → Нууц үг солих (одоогийн нууц үг шаардана) |
| Нууц үгээ мартсан, нэвтэрч чадахгүй | Break-glass (§3.3), session хүчингүй болгох шаардлагагүй |
| Түгжигдсэн (5 буруу оролдлого) | **Хүлээнэ**: 15 минутын дараа өөрөө дуусна, break-glass хэрэггүй. (Release-ээс өмнө хязгаар байхгүй) |
| Төхөөрөмж алдсан, акаунт эвдэрсэн байж болзошгүй | Break-glass **+ session хүчингүй болгох** (§3.5) заавал |

### 3.2 Үүрэг ба урьдчилсан нөхцөл

- **Хүсэгч**: ADMIN (эсвэл түүнийг төлөөлөх захирал).
- **Баталгаажуулагч A, B**: хоёр нэр бүхий, эрх бүхий хүн (жишээ нь гүйцэтгэх захирал ба санхүү эрхэлсэн захирал). Хүсэгч, operator хоёр биш, бие биенээсээ бусад. Тэдний нэр, и-мэйл урьдчилан бичигдсэн байх.
- **Operator**: Aiven console/SQL editor-т эрхтэй хүн. ADMIN биш.
- **Бүртгэл**: change log (аппаас гадуурх), тасалбарын дугаартай.
- Урьдчилан: Aiven-ээс **шууд backup / fork** авч, цагийг тэмдэглэнэ.

### 3.3 Алхам

1. **Хүсэлт.** Бичгээр: хэн, яагаад, ямар цагт. Хувийн байдлыг **аппаас гадуур** (биечлэн эсвэл дуут/видео залгалт, үнэмлэх) баталгаажуулна.
2. **Хоёр баталгаажуулалт.** A ба B тус бүр өөрийн сувгаар (и-мэйл/бичиг) "зөвшөөрч байна, тасалбар №…" гэж хариулна. Хугацаа: **24 цаг**.
3. **Backup.** Operator Aiven дээр шууд backup авна, цагийг тасалбарт бичнэ.
4. **Hash.** ADMIN өөрийн нууц үгийг (тусгай, шинэ, өөр газар ашигладаггүй) сонгоод **өөрийн компьютер дээр** hash болгоно. Нууц үг командын мөрөнд/түүхэнд үлдэхгүйгээр:
   ```sh
   read -rs PW; PW="$PW" node -e "require('bcrypt').hash(process.env.PW,10).then(console.log)"
   ```
   (repo-ийн `node_modules/bcrypt`-тай хавтаснаас.) Зөвхөн hash (`$2b$10$…`) operator-т очно.
5. **SQL (operator, Aiven SQL editor, нэг транзакц).** `<…>` талбарыг бөглөнө. Эхний SELECT нь **яг 1 мөр** буцаах ёстой, эс бөгөөс ROLLBACK хийнэ.
   ```sql
   BEGIN;

   SELECT id, email, role, "isActive" FROM "User"
   WHERE email = '<admin email>' AND role = 'ADMIN' AND "isActive";      -- яг 1 мөр

   UPDATE "User"
   SET "passwordHash" = $h$<bcrypt hash>$h$, "updatedAt" = now()
   WHERE id = '<ADMIN_ID>' AND role = 'ADMIN' AND "isActive";             -- UPDATE 1

   INSERT INTO "AuditLog" (id, "entityType", "entityId", action, "actorId", "afterJson", "createdAt")
   VALUES (gen_random_uuid()::text, 'User', '<ADMIN_ID>', 'RESET_CREDENTIALS', '<ADMIN_ID>',
     '{"kind":"BREAK_GLASS_RECOVERY","ticket":"<№>","authorisedBy":["<A>","<B>"],"performedBy":"db-operator:<нэр>","expiresAt":"<ISO>"}',
     now());                                                              -- INSERT 0 1

   INSERT INTO "Notification" (id, "userId", type, title, body, "createdAt")
   SELECT gen_random_uuid()::text, u.id, 'GENERIC', 'Админы нууц үг сэргээгдлээ',
          'Break-glass журмаар админы нууц үг сэргээгдлээ. Тасалбар №<№>. Хэрэв та мэдээгүй бол даруй мэдэгдээрэй.', now()
   FROM "User" u
   WHERE u.id = '<ADMIN_ID>'
      OR u.id IN (SELECT "userId" FROM "ApprovalRoleAssignment" WHERE role = 'EXECUTIVE_DIRECTOR' AND "isActive")
      OR u.email IN ('<A email>', '<B email>');

   COMMIT;   -- эсвэл ROLLBACK, хэрэв дээрх мөрийн тоо таарахгүй бол
   ```
   `actorId` нь FK тул аудитын actor нь ADMIN өөрөө гэж харагдана; бодит гүйцэтгэгч нь `performedBy`-д бичигдсэн. Энэ нь тодорхой хязгаарлалт.
6. **Шалгалт (read-only).** ADMIN шинэ нууц үгээрээ нэвтэрнэ. Operator:
   ```sql
   SELECT count(*) FROM "User" WHERE role='ADMIN' AND "isActive";  -- 1 хэвээр
   SELECT action, "createdAt", "afterJson" FROM "AuditLog" WHERE "entityId"='<ADMIN_ID>' ORDER BY "createdAt" DESC LIMIT 3;
   ```
7. **Хаах.** Тасалбарт: хугацаа, хүсэгч, A, B, operator, backup цаг, hash-ийн хуулбар **үлдээхгүй** (устгана). Нэг цагийн дотор ADMIN нууц үгээ Тохиргооноос дахин солих нь зөвлөмж (shared компьютер дээр hash хийсэн бол заавал). Дараагийн `CHANGE_PASSWORD` аудит мөрийг operator шалгана.

### 3.4 PIN
Ганц ADMIN-д батлах албан тушаал (`ApprovalRoleAssignment`) байхгүй гэж үзнэ (ADMIN role нь албан тушаалд хамаарахгүй). Хэрэв мөн албан тушаалтай бол: нууц үгээ сэргээсний дараа PIN-ээ **өөрөө** `/api/me/pin`-ээр (нууц үгээ оруулж) тохируулна. Админ өөрийн PIN-ийг цуцалж чадахгүй (кодод хориотой); operator PIN мөрийг устгах нь **тусдаа хоёр хүний зөвшөөрөлтэй** үйлдэл бөгөөд энэ журмын хүрээнд **хийхгүй**.

### 3.5 Хуучин session хүчингүй болгох

**Stage 2 migration + код орсны ДАРАА** (`20261110090000_add_session_version`, `docs/security-stage-2-4.md`): `User.sessionVersion` байна, JWT нь үүнийг агуулдаг, нууц үг өөрчлөх/сэргээх/идэвхгүй болгох бүрд нэмэгдэж хуучин session-ууд **тухайн хэрэглэгчийн** хувьд л хүчингүй болно. Break-glass SQL (§3.3-5) энэ тохиолдолд нэмэлт хоёр баганыг шинэчилнэ:
```sql
UPDATE "User" SET "passwordHash" = $h$<bcrypt hash>$h$, "updatedAt" = now(),
       "passwordChangedAt" = now(), "sessionVersion" = "sessionVersion" + 1
WHERE id = '<ADMIN_ID>' AND role = 'ADMIN' AND "isActive";
```
Үүний дараа `NEXTAUTH_SECRET` солих шаардлагагүй (бүх хэрэглэгчийг гаргахгүй). Хязгаар: өөр serverless instance хуучин токеныг ~5 секунд хүртэл зөвшөөрч болно.

**Stage 2 орохоос ӨМНӨ** (одоогийн production): `sessionVersion` багана байхгүй, тиймээс дээрх хоёр баганыг ЗАСАХГҮЙ. Session хүчингүй болгох цорын ганц арга нь Vercel дээр `NEXTAUTH_SECRET` солиод redeploy хийх (**бүх** хэрэглэгч гарна). Төхөөрөмж алдсан/акаунт эвдэрсэн тохиолдолд заавал; нууц үг мартсан бол шаардлагагүй. Идэвхгүй болгоод дахин идэвхжүүлэх арга **ажиллахгүй** (хуучин токен буцаж хүчинтэй болдог байсан; Stage 2 үүнийг засна).

## 4. Шаардлага ба одоогийн байдал

| Шаардлага | Одоогийн байдал |
| --- | --- |
| Хоёр эрх бүхий хүний баталгаажуулалт | Break-glass-д **журмаар** (§3.2), аппаар албадагдахгүй. Энгийн эрх олголт админаар шууд хийгдэнэ (Stage 1.5 хамгаалалттай); гүйцэтгэх захирлын нэмэлт зөвшөөрөл шаардахгүй. |
| Тусдаа audit | **Гараар**: `RESET_CREDENTIALS` / `BREAK_GLASS_RECOVERY` мөр (§3.3-5). Програм автоматаар бичдэггүй. |
| Мэдэгдэл | **Гараар** INSERT. Автомат биш. |
| Хугацааны хязгаар | **Байгууллагын** (24 цаг); програм хүчээр хэрэгжүүлдэггүй. |
| Хуучин session хүчингүй болгох | **Stage 2-оос өмнө хангахгүй** (зөвхөн `NEXTAUTH_SECRET` солих). **Stage 2 орсны дараа** хэрэгжинэ: `sessionVersion`, нууц үг/идэвхгүй болгох бүрд (§3.5). |
| PIN/approval audit-ийг тойрохгүй | **Журмаар** (зөвхөн нэг `passwordHash` мөр), програмаар хамгаалагдаагүй. |
| Админ өөрийн эрхийг бусдад байнга олгохгүй | Журмаар; role/албан тушаал олгох нь Stage 1.5 guard-аар (нууц үг + шалтгаан + мэдэгдэл), гэхдээ ганц админ өөрөө үүнийг дуудна. |

## 5. Release-ийн хоёр migration: дахин шалгалт

Production-д `_prisma_migrations`-д 5 мөр бий (хэрэглэгчийн мэдээлснээр), дутуу нь:

1. **`20261105160000_add_warehouse_check_item_request_item_index`**
   ```sql
   CREATE INDEX "WarehouseCheckItem_requestItemId_idx" ON "WarehouseCheckItem"("requestItemId");
   ```
   Нөлөө: өгөгдөл өөрчлөгдөхгүй. Энгийн (CONCURRENTLY биш) `CREATE INDEX` нь байгуулах хугацаанд `WarehouseCheckItem` хүснэгт дээр **бичих үйлдлийг түгжинэ** (унших боломжтой). Prisma migration-ийг транзакцад ажиллуулдаг тул CONCURRENTLY ашиглах боломжгүй. Хүснэгтийн мөрийн тоог (`SELECT count(*) FROM "WarehouseCheckItem";`, read-only) урьдчилан үзэж, хөдөлгөөн багатай цагт ажиллуулна. Одоогийн production код (`157b20c`) индексийг ашиглахгүй, ямар ч хугацаанд эвдрэхгүй.
2. **`20261109120000_add_login_throttle`**
   ```sql
   CREATE TABLE "LoginThrottle" (...);  CREATE INDEX "LoginThrottle_windowStart_idx" ON "LoginThrottle"("windowStart");
   ```
   Нөлөө: шинэ хүснэгт, одоо байгаа өгөгдөл/хүснэгтэд нөлөөгүй; хуучин код үл тоомсорлоно. Шинэ код хүснэгтгүйгээр нэвтрэлтийг **хаалттай** болгоно (fail closed), иймд migration нь кодоос **өмнө** ажиллах ёстой.

Дараалал: Prisma нэрийн дарааллаар (1 дараа 2) ажиллуулна; нэгийг нь орхиж **болохгүй**. Aiven дээр pooler биш **шууд (direct)** холболт ашиглана (advisory lock). Зөвхөн 5 дууссан бүртгэлд `finished_at` NULL / `rolled_back_at` байхгүй (хэрэглэгч баталгаажуулсан) бол `migrate deploy` өөр юу ч хийхгүй.

## 6. Backup restore туршилт, rollback, smoke test

### 6.1 Restore туршилтын төлөвлөгөө (хийгдээгүй)
Aiven backup-г restore хийж үзээгүй тул үнэмлэхүй баталгаа байхгүй. Release-ээс ӨМНӨ:
1. Aiven console-оос хамгийн сүүлийн backup (эсвэл PITR цаг) сонгож **шинэ service болгон fork** хийнэ (production-д нөлөөгүй, тусдаа зардалтай).
2. Fork дээр read-only шалгалт: `SELECT count(*)` — `User`, `MaterialRequest`, `ApprovalStep`, `AuditLog`; `_prisma_migrations` 5 мөр; хамгийн сүүлийн `AuditLog.createdAt` нь backup-ийн цагтай таарна.
3. (Заавал биш) Vercel-ийн **preview** deployment-ийг fork-ийн URL-тай ажиллуулж нэвтэрч үзнэ (production env-д хүрэхгүй).
4. Хугацааг (restore хэр удсан) тэмдэглэж, fork-ийг **устгана**.
5. Үр дүнг бичнэ: restore-ийн хугацаа, мэдээллийн бүрэн байдал. Үүнгүйгээр rollback-ийн DB хэсэг нотлогдоогүй.

### 6.2 Rollback
- **Код**: Vercel-ийн өмнөх deployment (`157b20c`)-ийг Promote/Redeploy. `LoginThrottle` хүснэгт болон индекс **үлдэнэ**, хуучин код үл тоомсорлоно (PG 18.6 дээр rehearsal-аар батлагдсан). Хүснэгт устгах шаардлагагүй.
- **DB**: зөвхөн өгөгдөл эвдэрсэн тохиолдолд Aiven backup/PITR-аас **шинэ service-д fork** хийж, шалгаад л солих (in-place restore хийхгүй). Энэ нь release-ийн migration-ийн улмаас хэрэгтэй болохгүй (аддитив).
- **Нэвтрэх асуудал** (throttle): rollback хийвэл хуучин код throttle ашиглахгүй тул шийдэгдэнэ.

### 6.3 Smoke test (deploy-ийн дараа, production)
1. ADMIN нэвтрэх (компьютер).
2. iPhone Safari-аар нэвтрэх (мэдэгдэж буй өмнөх асуудал), и-мэйл нэмэлт зайгүй.
3. Буруу нууц үгээр 5 удаа оролдоход хязгаар мессеж гарч, 15 минутын дараа буцаж нэвтэрч болдог эсэх (өөр хэрэглэгчээр, ADMIN-аар биш).
4. Нэг захиалга үүсгэж → хэлтсийн дарга батлах → одоо байгаа батлалтын гинж ажиллаж байгаа эсэх (хуучин өгөгдөл өөрчлөгдөөгүй).
5. PIN: батлах албан тушаалтай хэрэглэгч PIN-ээ нууц үгээрээ тохируулж/баталж болдог эсэх.
6. ADMIN дээр эрх олгох диалог: албан тушаал оноохдоо нууц үг + шалтгаан + баталгаажуулалт асууж, мэдэгдэл үүсэж байгаа эсэх.
7. `/profile` нээгдэнэ; Time Machine, Backup Vault хуудсууд нээгдэнэ (код өөрчлөгдөөгүй).
8. Vercel log-д алдаа, `THROTTLE_UNAVAILABLE` байхгүй.

## 7. ADMIN impersonation: HIGH эрсдэл (тусад нь, шийдэгдээгүй)

- Ганц ADMIN байх нь **эрсдэлийг нэмэгдүүлнэ**: ADMIN акаунт эвдэрвэл (нууц үг алдагдах, төхөөрөмж алдах, хуурамч сэргээлт) бүх систем эвдэрнэ. Түүнийг хянах хоёр дахь админ байхгүй.
- Stage 1/1.5 нь эрсдэлийг удаашруулж, илрүүлэхүйц болгосон боловч **зогсоодоггүй**: админ энгийн ажилтны нууц үгийг сэргээж түр нууц үгийг мэдэж, түүгээр нэвтэрч, нууц үгийг солиод, дараа нь эрх олгож болно; эрхтэй акаунт шууд үүсгэж болно. Мэдэгдэл (ажилтан, гүйцэтгэх захирал) л хяналт.
- Break-glass журам энэ эрсдэлийг **шийдэхгүй**; хэрэв operator ба ADMIN нэг хүн бол нэмэлт хяналт ч байхгүй.
- Хэрэгжүүлэх ёстой: Stage 2 (session revoke, `mustChangePassword`, түр нууц үгийн хугацаа), Stage 4 (ажилтны өөрийн сэргээх холбоос). Хоёр хүний зөвшөөрөл одоогоор шаардахгүй.
- **Release хийхэд байгууллагын бичгэн risk acceptance заавал шаардлагатай.**

## 8. Үлдсэн эрсдэлийн жагсаалт

| # | Эрсдэл | Түвшин | Байдал |
| --- | --- | --- | --- |
| 1 | ADMIN impersonation (§7) | HIGH | Шийдэгдээгүй |
| 2 | Нэг ADMIN: сэргээх нь гараар, operator-оос хамаарна | HIGH | Журмаар хөнгөрүүлсэн |
| 3 | Per-user session revoke байхгүй; секрет солих = бүгдийг гаргах | HIGH | Schema ажил шаардлагатай |
| 4 | Backup restore бодитоор туршаагүй | MEDIUM | Release-ээс өмнө §6.1 |
| 5 | `CREATE INDEX` нь `WarehouseCheckItem`-д бичих үйлдлийг түр түгжинэ | LOW–MEDIUM | Мөрийн тоо шалгаж, нам цагт |
| 6 | iPhone Safari-г бодитоор шалгаагүй (WebKit энд ажиллахгүй) | MEDIUM | Smoke test §6.3 |
| 7 | Aiven operator = ADMIN бол хяналт үгүй | HIGH | Тусад нь хүн оноох |
| 8 | Audit log-ийг DB эзэн засаж болно | MEDIUM | Tamper-evident log хэрэгжээгүй |
| 9 | Main tree-д дуусаагүй executive/deferred код нь ижил файлуудыг өөрчилсөн (merge зөрчил) | MEDIUM | Дараа нь тусад нь merge |
| 10 | Release-ийн дараах нэвтрэлтийн throttle: хүснэгт алга бол нэвтрэлт хаалттай | MEDIUM | Migration кодоос ӨМНӨ |

## 9. Production deployment checklist

**Өмнө (бүгд ✓ болтол deploy хийхгүй):**
- [ ] Байгууллагын бичгэн risk acceptance (§7).
- [ ] Break-glass журамд хоёр баталгаажуулагч, operator нэрлэгдсэн; operator ≠ ADMIN.
- [ ] Aiven backup шинэхэн, PITR-ийн цаг тэмдэглэсэн; restore fork туршилт хийгдсэн (§6.1).
- [ ] `_prisma_migrations`: 5 мөр бүгд `finished_at` бүхий, `rolled_back_at` NULL (read-only, хэрэглэгч баталгаажуулсан) ба **яг** 2 хүлээгдэж буй (§5).
- [ ] `SELECT count(*) FROM "WarehouseCheckItem"` — бага, нам цаг сонгосон.
- [ ] Vercel env нэрс байгаа (`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, S3 бүлэг); `DATABASE_URL` нь `pg-1549c634`/`defaultdb` (утгыг хуваалцахгүйгээр).
- [ ] Release-ийн commit `f518643` (эсвэл шинэчилсэн) дээр tsc/eslint/vitest/build/Playwright дахин ногоон.
- [ ] Хэрэглэгчид, админд шинэ диалог, onboarding дараалал (үүсгэх → өөрөө нууц үг солих → эрх олгох) тайлбарласан.

**Үйлдлүүд (тус бүр тусдаа зөвшөөрөл):** §10.

**Дараа:** smoke test §6.3, Vercel log, нэг хоногийн дараа `LoginThrottle` мөр, мэдэгдлийн урсгалыг хянах.

## 10. Миний (хэрэглэгчийн) тусдаа, тодорхой зөвшөөрөл шаардлагатай үйлдлүүд

1. `prisma migrate status` production-ийн эсрэг (read-only хэдий ч production холболт).
2. `prisma migrate deploy` production-д (2 migration).
3. `release/profile-security`-ийг `feature/monitoring-perf-realtime` руу fast-forward / push (Vercel deploy өдөөнө).
4. `docs/single-admin-recovery.md`-ийг commit хийх.
5. Aiven fork/restore туршилт (зардал, шинэ service).
6. `NEXTAUTH_SECRET` солих (бүх хэрэглэгчийг гаргана).
7. Break-glass SQL-ийг production-д ажиллуулах (тохиолдол бүрт).
8. Stage 2/3/4 schema ажлыг эхлүүлэх.

## 11. GO / NO-GO

**NO-GO** (одоо). Шалтгаан: production-ийн бодит шалгалт хийгдээгүй (энэ session-д холболт байхгүй), restore туршаагүй, risk acceptance байхгүй, ганц ADMIN-ийн сэргээх нь гараар ба session revoke хэрэгжээгүй.

**GO болох нөхцөл:** §9-ийн "Өмнө" жагсаалт бүрэн ✓, §10-ийн 1–3 зөвшөөрөл өгөгдсөн. Код ба migration нь (PG 18.6 дээр rehearsal-аар) тэр хүртэл бэлэн.
