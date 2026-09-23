import os
import re
import tempfile
import subprocess
import uuid
import base64
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from fastapi import Cookie, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE_MB", "100")) * 1024 * 1024
SIGNED_URL_SECONDS = int(os.getenv("SIGNED_URL_SECONDS", "604800"))
SESSION_MAX_AGE = 30 * 24 * 60 * 60
LOGIN_WINDOW_SECONDS = 300
LOGIN_MAX_FAILURES = 8
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "fawad malik").strip().lower()
LOGIN_LIMIT = {}
AUTH_COOKIE = "reelgrab_session"
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://reelgrab-3wzu.onrender.com").rstrip("/")
ALLOWED_ORIGINS = list(dict.fromkeys([FRONTEND_ORIGIN, "https://reelgrab-3wzu.onrender.com"] + [x.strip().rstrip("/") for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()]))

app = FastAPI(title="ReelGrab MP4 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https://[a-z0-9-]+\.onrender\.com$",
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Type"],
)


@app.middleware("http")
async def reinforce_cors_headers(request, call_next):
    response = await call_next(request)
    origin = request.headers.get("origin")
    if origin and (origin in ALLOWED_ORIGINS or re.fullmatch(r"https://[a-z0-9-]+\.onrender\.com", origin)):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = request.headers.get("access-control-request-headers", "*")
        response.headers["Vary"] = "Origin"
    return response


class Credentials(BaseModel):
    username: str
    password: str
    email: str | None = None


class DownloadRequest(BaseModel):
    url: HttpUrl


def supabase_headers(service=False):
    key = SUPABASE_SERVICE_ROLE_KEY if service else SUPABASE_ANON_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return base64.b64encode(salt + b"." + key).decode("ascii")


def verify_password(password: str, stored: str) -> bool:
    try:
        raw = base64.b64decode(stored.encode("ascii"))
        salt, expected = raw.split(b".", 1)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(48)


def validate_credentials(x: Credentials, require_email=False):
    username = x.username.strip().lower()
    email = (x.email or "").strip().lower() or None

    if not 3 <= len(username) <= 40:
        raise HTTPException(400, "Username must be 3–40 characters.")

    if len(x.password) < 8 or len(x.password) > 128:
        raise HTTPException(400, "Password must be 8–128 characters.")

    if require_email:
        if not email:
            raise HTTPException(400, "Email is required when creating an account.")
        if len(email) > 255:
            raise HTTPException(400, "Email address is too long.")
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise HTTPException(400, "Enter a valid email address.")

    return username, email


def db_get(path: str, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=supabase_headers(service=True), params=params or {}, timeout=15)
    if r.status_code != 200:
        raise HTTPException(500, "Account service is unavailable.")
    return r.json()


def db_insert(path: str, payload: dict):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={**supabase_headers(service=True), "Prefer": "return=representation"},
        json=payload,
        timeout=15,
    )
    return r


def db_delete(path: str, params=None):
    r = requests.delete(f"{SUPABASE_URL}/rest/v1/{path}", headers=supabase_headers(service=True), params=params or {}, timeout=15)
    if r.status_code not in (200, 204):
        raise RuntimeError("Database delete failed")


def create_session(user_id: str) -> str:
    token = new_session_token()
    r = db_insert("app_sessions", {"token": token, "user_id": user_id})
    if r.status_code not in (200, 201):
        raise HTTPException(500, "Could not create your session.")
    return token


def current_user(session_token: str | None):
    if not session_token:
        return None
    rows = db_get(
        "app_sessions",
        {
            "select": "token,user_id,created_at,app_users(id,username,email)",
            "token": f"eq.{session_token}",
            "limit": "1",
        },
    )
    if not rows:
        return None
    row = rows[0]
    created_at = row.get("created_at")
    if created_at:
        try:
            created = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - created).total_seconds()
            if age > SESSION_MAX_AGE:
                db_delete("app_sessions", {"token": f"eq.{session_token}"})
                return None
        except (ValueError, TypeError):
            pass
    user = row.get("app_users")
    if not user:
        return None
    return user


def is_admin_user(user: dict | None) -> bool:
    return bool(user and str(user.get("username", "")).strip().lower() == ADMIN_USERNAME)


def require_admin(session_token: str | None):
    user = require_user(session_token)
    if not is_admin_user(user):
        raise HTTPException(403, "Admin access required.")
    return user


def reset_admin_password(session_token: str | None, new_password: str):
    require_admin(session_token)
    if len(new_password) < 8 or len(new_password) > 128:
        raise HTTPException(400, "Password must be 8–128 characters.")
    rows = db_get("app_users", {"select": "id,username", "username": f"eq.{ADMIN_USERNAME}", "limit": "1"})
    if not rows:
        raise HTTPException(404, "Admin account not found.")
    user_id = rows[0]["id"]
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/app_users",
        params={"id": f"eq.{user_id}"},
        headers=supabase_headers(service=True),
        json={"password_hash": hash_password(new_password)},
        timeout=15,
    )
    if r.status_code not in (200, 204):
        raise HTTPException(500, "Could not reset the admin password.")
    db_delete("app_sessions", {"user_id": f"eq.{user_id}"})
    return {"ok": True}


def require_user(session_token: str | None):
    user = current_user(session_token)
    if not user:
        raise HTTPException(401, "Please log in.")
    return user


def is_supported_instagram_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if host not in {"instagram.com", "www.instagram.com", "m.instagram.com"}:
        return False
    return bool(re.match(r"^/(reel|reels|p)/[^/?#]+", parsed.path))


def download_record_insert(payload):
    return db_insert("downloads", payload)


def db_update(download_id, payload):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/downloads",
        params={"id": f"eq.{download_id}"},
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
    return signed if signed.startswith("http") else f"{SUPABASE_URL}/storage/v1{signed}"


@app.get("/health")
def health():
    return {"ok": True, "service": "reelgrab-mp4-api"}


@app.post("/api/auth/register")
def register(x: Credentials, response: Response):
    username, email = validate_credentials(x, require_email=True)
    existing = db_get("app_users", {"select": "id", "username": f"eq.{username}", "limit": "1"})
    if existing:
        raise HTTPException(409, "Username already exists.")
    payload = {"username": username, "password_hash": hash_password(x.password), "email": email}
    created = db_insert("app_users", payload)
    if created.status_code not in (200, 201):
        if created.status_code == 409:
            raise HTTPException(409, "Username already exists.")
        raise HTTPException(500, "Could not create your account.")
    user = created.json()[0]
    token = create_session(user["id"])
    response.set_cookie(AUTH_COOKIE, token, httponly=True, samesite="none", secure=True, max_age=SESSION_MAX_AGE)
    return {"id": user["id"], "username": user["username"], "email": user.get("email")}


@app.post("/api/auth/login")
def login(x: Credentials, response: Response):
    username, _ = validate_credentials(x)
    now = time.time()
    attempts = [t for t in LOGIN_LIMIT.get(username, []) if now - t < LOGIN_WINDOW_SECONDS]
    if len(attempts) >= LOGIN_MAX_FAILURES:
        raise HTTPException(429, "Too many failed login attempts. Please try again in a few minutes.")

    rows = db_get(
        "app_users",
        {"select": "id,username,email,password_hash", "username": f"eq.{username}", "limit": "1"},
    )
    user = rows[0] if rows else None
    if not user or not verify_password(x.password, user["password_hash"]):
        attempts.append(now)
        LOGIN_LIMIT[username] = attempts
        raise HTTPException(401, "Invalid username or password.")

    LOGIN_LIMIT.pop(username, None)
    token = create_session(user["id"])
    response.set_cookie(AUTH_COOKIE, token, httponly=True, samesite="none", secure=True, max_age=SESSION_MAX_AGE)
    return {"id": user["id"], "username": user["username"], "email": user.get("email")}


@app.get("/api/admin/dashboard")
def admin_dashboard(reelgrab_session: str | None = Cookie(default=None, alias=AUTH_COOKIE)):
    require_admin(reelgrab_session)

    users = db_get(
        "app_users",
        {
            "select": "id,username,email,created_at",
            "order": "created_at.desc",
            "limit": "500",
        },
    )
    downloads = db_get(
        "downloads",
        {
            "select": "id,user_id,reel_url,file_name,status,file_url,error_message,created_at,completed_at,app_users(username,email)",
            "order": "created_at.desc",
            "limit": "500",
        },
    )

    completed = sum(1 for item in downloads if item.get("status") == "completed")
    failed = sum(1 for item in downloads if item.get("status") == "failed")
    processing = sum(1 for item in downloads if item.get("status") == "processing")

    return {
        "admin": {"username": ADMIN_USERNAME},
        "stats": {
            "total_users": len(users),
            "total_downloads": len(downloads),
            "completed_downloads": completed,
            "failed_downloads": failed,
            "processing_downloads": processing,
        },
        "users": users,
        "downloads": downloads,
    }


@app.post("/api/admin/reset-password")
def admin_reset_password(x: Credentials, reelgrab_session: str | None = Cookie(default=None, alias=AUTH_COOKIE)):
    reset_admin_password(reelgrab_session, x.password)
    return {"ok": True}


@app.post("/api/auth/logout")
def logout(response: Response, reelgrab_session: str | None = Cookie(default=None, alias=AUTH_COOKIE)):
    if reelgrab_session:
        db_delete("app_sessions", {"token": f"eq.{reelgrab_session}"})
    response.delete_cookie(AUTH_COOKIE)
    return {"ok": True}


@app.get("/api/auth/me")
def me(reelgrab_session: str | None = Cookie(default=None, alias=AUTH_COOKIE)):
    return require_user(reelgrab_session)


@app.post("/api/download")
def download(body: DownloadRequest, reelgrab_session: str | None = Cookie(default=None, alias=AUTH_COOKIE)):
    user = require_user(reelgrab_session)
    url = str(body.url)

    if not is_supported_instagram_url(url):
        raise HTTPException(status_code=400, detail="Only Instagram Reel/Post URLs are supported.")

    download_id = None
    record_response = download_record_insert({"user_id": user["id"], "reel_url": url, "status": "processing"})
    if record_response.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Could not create download record.")
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
            if completed.returncode != 0:
                raise RuntimeError(completed.stderr[-1200:] or "yt-dlp could not retrieve this public media URL.")

            mp4s = [p for p in Path(tmp).glob("*.mp4")]
            if not mp4s:
                raise RuntimeError("The processor did not produce an MP4 file.")
            media = mp4s[0]

            if media.stat().st_size > MAX_FILE_SIZE:
                raise RuntimeError("The resulting MP4 is larger than the configured limit.")

            safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(download_id or uuid.uuid4()))
            storage_path = f"{user['id']}/{safe_id}.mp4"
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
