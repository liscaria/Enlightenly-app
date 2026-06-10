# Supabase setup for Enlightenly

This app already runs fully offline using IndexedDB. To also sync uploads to
Postgres + Storage, do the following one-time setup.

## 1. Create a Supabase project

1. Sign up at https://supabase.com (free tier is enough to start).
2. Create a new project. Pick any region close to you and set a database
   password (save it in your password manager).
3. Wait a minute for the project to provision.

## 2. Run the schema

1. In the Supabase dashboard, open **SQL editor**.
2. Open the file `db/supabase/schema.sql` from this repo and paste its
   contents into a new SQL query.
3. Click **Run**. It creates the `classes`, `units`, `chapters`, `materials`
   and `questions` tables, plus indexes and `updated_at` triggers.
4. Run `db/supabase/policies.sql` next. It turns on Row Level Security so each
   signed-in teacher only sees and edits **their own** classes and materials
   (`owner_id` = their Supabase user id).

**Already ran an older schema without `owner_id`?** Run, in order:

1. `db/supabase/migration_owner_id.sql` (drops old tables — backs up anything you need first)
2. `db/supabase/schema.sql`
3. `db/supabase/policies.sql`

## 3. Create the Storage bucket

The app uploads file bytes to a bucket named **`materials`** (see
`VITE_SUPABASE_BUCKET` in `.env.local`).

**Option A — SQL (recommended)**

1. Open **SQL editor** in Supabase.
2. Paste and run `db/supabase/storage_bucket.sql`.
3. Run `db/supabase/policies.sql` (storage access rules for signed-in users).

**Option B — Dashboard**

1. **Storage** → **New bucket**.
2. Name: `materials` (must match exactly unless you change the env var).
3. **Public bucket**: off (private is fine; the app uses authenticated uploads).
4. Run `db/supabase/policies.sql` afterward.

Confirm under **Storage** you see a bucket called `materials`. If the name differs,
set `VITE_SUPABASE_BUCKET` in `.env.local` to that name and restart `npm run dev`.

If `materials.storage_path` is empty in Table Editor, the Postgres row was saved
but **Storage upload failed** (missing bucket, storage RLS, or not signed in).
The app now shows that error on the Materials page — re-upload after fixing.

## 4. Enable authentication

The app uses **Supabase Auth**. Uploads to Postgres/Storage only work when
you are signed in (RLS policies require the `authenticated` role).

### Email + password

1. In Supabase: **Authentication** → **Providers** → ensure **Email** is enabled.
2. Keep **Allow new users to sign up** **on** so teachers can use **Create account** in the app.
3. For development you can disable **Confirm email** under Email settings so sign-up works
   immediately without clicking a link.
4. In the app: **Create account**, then **Sign in** with the same email/password.

Each user only sees their own classes, materials, and question bank (`owner_id` = their user id).
Run `db/supabase/policies.sql` so Row Level Security enforces this in Postgres.

Or create a user manually: **Authentication** → **Users** → **Add user**.

### Google (optional)

1. **Authentication** → **Providers** → **Google** → enable.
2. Follow Supabase’s guide to add Google OAuth client ID/secret.
3. Under **URL configuration**, add redirect URLs:
   - `http://localhost:5173/dashboard`
   - Your production URL + `/dashboard` when you deploy.

## 5. Wire credentials into the app

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. Fill in the values from **Project Settings → API**:
   - `VITE_SUPABASE_URL` = the project URL
   - `VITE_SUPABASE_ANON_KEY` = the anon public key
   - `VITE_SUPABASE_BUCKET` = the bucket name you created (default `materials`)
3. Install the client and run the app:
   ```bash
   npm install
   npm run dev
   ```

The browser console will say `[Enlightenly] Supabase not configured...` if it
cannot find the env vars. Once it is configured, every catalog edit and every
material upload is mirrored to Postgres / Storage. Local IndexedDB continues to
work as an offline cache.

## 6. What gets stored where

| Where             | What                                                                 |
|-------------------|----------------------------------------------------------------------|
| `auth.users`      | Account created on sign-up (Supabase Auth; not in `schema.sql`)      |
| `classes`         | One row per class per teacher (`owner_id` + `class-xi`, etc.)        |
| `units`           | Units of each class with marks                                       |
| `chapters`        | Chapters of each unit                                                |
| `materials`       | One row per uploaded file: type, source, storage path, etc.        |
| `questions`       | One row per question extracted from a question paper (empty for now) |
| Storage bucket    | File bytes at `{userId}/classId/unitId/chapterId/...` (private per user) |
| Browser           | Catalog cache in `localStorage` under `teachingCatalog:{userId}`     |

## 7. Querying later

```sql
-- Question papers for Class XII Unit-VI, Test source (current user only via RLS)
select id, name, exam_source, storage_path
from materials
where owner_id     = auth.uid()
  and class_id     = 'class-xii'
  and unit_id      = 'xii-unit-6'
  and material_type = 'Question papers'
  and exam_source  = 'Test'
order by created_at desc;
```

When AI extraction comes online it will populate `public.questions`, so the
same kind of query gives you individual questions filtered by chapter / exam source.
