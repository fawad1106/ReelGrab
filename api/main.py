import os
import re
import tempfile
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE_MB", "100")) * 1024 * 1024
SIGNED_URL_SECONDS = int(os.getenv("SIGNED_URL_SECONDS", "604800"))

app = FastAPI(title="ReelGrab MP4 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Authorization", "Content-Type"],
)

class DownloadRequest(BaseModel):
    url: HttpUrl


def supabase_headers(service=False, bearer=None):
    key = SUPABASE_SERVICE_ROLE_KEY if service else SUPABASE_ANON_KEY
    headers = {"apikey": key, "Content-Type": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    elif service:
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    return headers


def get_user(access_token: str):
    if not access_token:
        raise HTTPException(status_code=401, detail="Sign in is required.")
    r = requests.get(
        f"{SUPABASE_URL}/auth/v1/user",
        headers=supabase_headers(bearer=access_token),
        timeout=15,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    return r.json()


def is_supported_instagram_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if host not in {"instagram.com", "www.instagram.com", "m.instagram.com"}:
        return False
    return bool(re.match(r"^/(reel|reels|p)/[^/?#]+", parsed.path))


def db_insert(payload):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/downloads",
        headers={**supabase_headers(service=True), "Prefer": "return=representation"},
        json=payload,
        timeout=15,
    )
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Could not create download record.")
    return r.json()[0]


def db_update(download_id, payload):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/downloads?id=eq.{download_id}",
        headers=supabase_headers(service=True),
        json=payload,
        timeout=15,
    )
    if r.status_code not in (200, 204):
        raise RuntimeError("Could not update download record")


def upload_file(path: Path, storage_path: str):
    with path.open("rb") as fh:
        r = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/downloads/{storage_path}",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "video/mp4",
                "x-upsert": "true",
            },
            data=fh,
            timeout=180,
        )
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Storage upload failed: {r.text[:300]}")


def create_signed_url(storage_path: str):
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/sign/downloads/{storage_path}",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        },
        json={"expiresIn": SIGNED_URL_SECONDS},
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Could not create signed URL: {r.text[:300]}")
    signed = r.json().get("signedURL")
    if not signed:
        raise RuntimeError("Supabase did not return a signed URL")
    if signed.startswith("http"):
        return signed
    return f"{SUPABASE_URL}/storage/v1{signed}"


@app.get("/health")
def health():
    return {"ok": True, "service": "reelgrab-mp4-api"}


@app.post("/api/download")
def download(body: DownloadRequest, authorization: str | None = Header(default=None)):
    token = authorization.removeprefix("Bearer ").strip() if authorization else ""
    user = get_user(token)
    url = str(body.url)

    if not is_supported_instagram_url(url):
        raise HTTPException(status_code=400, detail="Only Instagram Reel/Post URLs are supported.")

    record = db_insert({
        "user_id": user["id"],
        "reel_url": url,
        "status": "processing",
    })
    download_id = record["id"]

    try:
        with tempfile.TemporaryDirectory() as tmp:
            output_template = str(Path(tmp) / "%(id)s.%(ext)s")
            command = [
                "yt-dlp",
                "--no-playlist",
                "--max-filesize", str(MAX_FILE_SIZE),
                "--restrict-filenames",
                "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
                "--merge-output-format", "mp4",
                "-o", output_template,
                url,
            ]
            completed = subprocess.run(command, capture_output=True, text=True, timeout=120)
            if completed.returncode != 0:
                raise RuntimeError(completed.stderr[-1200:] or "yt-dlp could not retrieve this public media URL.")

            files = list(Path(tmp).glob("*"))
            mp4s = [p for p in files if p.suffix.lower() == ".mp4"]
            if not mp4s:
                raise RuntimeError("The processor did not produce an MP4 file.")
            media = mp4s[0]

            if media.stat().st_size > MAX_FILE_SIZE:
                raise RuntimeError("The resulting MP4 is larger than the configured limit.")

            safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(download_id))
            storage_path = f"{user['id']}/{safe_id}.mp4"
            upload_file(media, storage_path)
            signed_url = create_signed_url(storage_path)

            db_update(download_id, {
                "status": "completed",
                "file_name": f"{safe_id}.mp4",
                "file_url": signed_url,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })

            return {
                "ok": True,
                "download_id": download_id,
                "file_name": f"{safe_id}.mp4",
                "file_url": signed_url,
                "expires_in": SIGNED_URL_SECONDS,
            }

    except subprocess.TimeoutExpired:
        error = "Processing timed out."
    except Exception as exc:
        error = str(exc)[:1000]

    try:
        db_update(download_id, {"status": "failed", "error_message": error})
    except Exception:
        pass
    raise HTTPException(status_code=422, detail=error)
