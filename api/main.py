import os
import re
import tempfile
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE_MB", "100")) * 1024 * 1024
SIGNED_URL_SECONDS = int(os.getenv("SIGNED_URL_SECONDS", "604800"))
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://reelgrab-3wzu.onrender.com").rstrip("/")
ALLOWED_ORIGINS = list(dict.fromkeys(
    [FRONTEND_ORIGIN, "https://reelgrab-3wzu.onrender.com"] +
    [x.strip().rstrip("/") for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()]
))

app = FastAPI(title="ReelGrab MP4 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https://[a-z0-9-]+\.onrender\.com$",
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Type"],
)


class DownloadRequest(BaseModel):
    url: HttpUrl


def supabase_headers():
    key = SUPABASE_SERVICE_ROLE_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def db_insert(path: str, payload: dict):
    return requests.post(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={**supabase_headers(), "Prefer": "return=representation"},
        json=payload,
        timeout=15,
    )


def db_update(download_id, payload):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/downloads",
        params={"id": f"eq.{download_id}"},
        headers=supabase_headers(),
        json=payload,
        timeout=15,
    )
    if r.status_code not in (200, 204):
        raise RuntimeError("Could not update download record")


def is_supported_instagram_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if host not in {"instagram.com", "www.instagram.com", "m.instagram.com"}:
        return False
    return bool(re.match(r"^/(reel|reels|p)/[^/?#]+", parsed.path))


def is_supported_youtube_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if host in {"youtu.be", "www.youtu.be"}:
        return bool(parsed.path.strip("/"))
    if host not in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        return False
    return bool(re.match(r"^/(watch|shorts|live|embed)/[^/?#]+", parsed.path))


def source_name(value: str) -> str:
    if is_supported_youtube_url(value):
        return "YouTube"
    if is_supported_instagram_url(value):
        return "Instagram"
    return "supported source"


def download_record_insert(payload):
    return db_insert("downloads", payload)


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
    return signed if signed.startswith("http") else f"{SUPABASE_URL}/storage/v1{signed}"


@app.get("/health")
def health():
    return {"ok": True, "service": "reelgrab-mp4-api"}


@app.post("/api/download")
def download(body: DownloadRequest):
    url = str(body.url)

    if not (is_supported_instagram_url(url) or is_supported_youtube_url(url)):
        raise HTTPException(
            status_code=400,
            detail="Only supported Instagram Reel/Post and YouTube video URLs are accepted.",
        )

    download_id = None
    # Downloads are currently anonymous. user_id is optional until authentication
    # is wired into this endpoint.
    record_response = download_record_insert({
        "reel_url": url,
        "status": "processing"
    })
    if record_response.status_code not in (200, 201):
        raise HTTPException(
            status_code=500,
            detail=f"Could not create download record: {record_response.text[:300]}",
        )
    record_rows = record_response.json()
    download_id = record_rows[0]["id"] if record_rows else None

    try:
        with tempfile.TemporaryDirectory() as tmp:
            output_template = str(Path(tmp) / "%(id)s.%(ext)s")
            command = [
                "yt-dlp", "--no-playlist", "--max-filesize", str(MAX_FILE_SIZE),
                "--restrict-filenames", "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
                "--merge-output-format", "mp4", "-o", output_template, url,
            ]
            completed = subprocess.run(command, capture_output=True, text=True, timeout=120)

            # Retry with a simpler progressive MP4 selector when the preferred
            # video+audio merge fails. YouTube additionally uses web_embedded,
            # which is currently a useful public-client fallback.
            if completed.returncode != 0:
                fallback_command = [
                    "yt-dlp", "--no-playlist", "--max-filesize", str(MAX_FILE_SIZE),
                    "--restrict-filenames",
                ]
                if is_supported_youtube_url(url):
                    fallback_command += [
                        "--extractor-args", "youtube:player_client=web_embedded"
                    ]
                fallback_command += [
                    "-f", "best[ext=mp4]/best", "--merge-output-format", "mp4",
                    "-o", output_template, url,
                ]
                completed = subprocess.run(
                    fallback_command, capture_output=True, text=True, timeout=120
                )

            if completed.returncode != 0:
                error_detail = completed.stderr.strip() or completed.stdout.strip()
                raise RuntimeError(
                    error_detail[-1200:] or
                    f"yt-dlp could not retrieve this {source_name(url)} URL."
                )

            mp4s = [p for p in Path(tmp).glob("*.mp4")]
            if not mp4s:
                raise RuntimeError("The processor did not produce an MP4 file.")
            media = mp4s[0]

            if media.stat().st_size > MAX_FILE_SIZE:
                raise RuntimeError("The resulting MP4 is larger than the configured limit.")

            safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(download_id or uuid.uuid4()))
            storage_path = f"anonymous/{safe_id}.mp4"
            upload_file(media, storage_path)
            signed_url = create_signed_url(storage_path)

            if download_id:
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

    if download_id:
        try:
            db_update(download_id, {"status": "failed", "error_message": error})
        except Exception:
            pass
    raise HTTPException(status_code=422, detail=error)
