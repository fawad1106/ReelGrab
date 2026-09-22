# ReelGrab

Vanilla HTML/CSS/JS frontend + Supabase + a separate FastAPI/yt-dlp MP4 processing API.

## 1. Supabase

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL Editor.
3. Enable Email OTP in Authentication if you want passwordless email sign-in.
4. Put the project's URL and **anon/publishable key** in `js/config.js`.
5. Never put the Supabase `service_role` key in frontend files.

## 2. MP4 processing API

The API only accepts Instagram Reel/Post URLs and requires a valid Supabase user access token. It is intended for public content you are allowed to download.

### Local

```bash
cd api
cp .env.example .env
# Fill in the variables in .env
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Set this in `js/config.js`:

```js
window.DOWNLOAD_API_URL = "http://localhost:8000/api/download";
```

### Docker

```bash
cd api
docker build -t reelgrab-api .
docker run --env-file .env -p 8000:8000 reelgrab-api
```

The Docker image installs FFmpeg because yt-dlp may need it to merge audio/video into an MP4.

## 3. Production

Deploy the `api/` folder to a server that can run Docker or Python (for example Railway or another container host). Set all environment variables there. Then change `DOWNLOAD_API_URL` in `js/config.js` to the production `/api/download` URL.

Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.

## Notes

- The browser never receives the service-role key.
- MP4 files are stored in the private `downloads` Supabase Storage bucket.
- The API creates a temporary signed URL for the finished file.
- Signed URLs expire; the stored history URL therefore needs refreshing if you want downloads to remain available indefinitely.
- Instagram may require authentication or may change its delivery mechanisms; public URLs that yt-dlp cannot access will fail rather than bypassing access controls.
