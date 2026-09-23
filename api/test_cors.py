import asyncio
import os
import sys
import unittest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")

sys.path.insert(0, os.path.dirname(__file__))
from main import app


class CorsRegressionTests(unittest.TestCase):
    def test_render_frontend_preflight_gets_credentialed_cors_headers(self):
        sent = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        scope = {
            "type": "http",
            "http_version": "1.1",
            "method": "OPTIONS",
            "scheme": "https",
            "path": "/api/auth/register",
            "raw_path": b"/api/auth/register",
            "query_string": b"",
            "headers": [
                (b"host", b"reelgrab-api-79yl.onrender.com"),
                (b"origin", b"https://reelgrab-3wzu.onrender.com"),
                (b"access-control-request-method", b"POST"),
                (b"access-control-request-headers", b"content-type"),
            ],
            "client": ("127.0.0.1", 12345),
            "server": ("reelgrab-api-79yl.onrender.com", 443),
        }

        asyncio.run(app(scope, receive, send))

        response = next(message for message in sent if message["type"] == "http.response.start")
        headers = {key.lower(): value for key, value in response["headers"]}

        self.assertEqual(response["status"], 200)
        self.assertEqual(headers[b"access-control-allow-origin"], b"https://reelgrab-3wzu.onrender.com")
        self.assertEqual(headers[b"access-control-allow-credentials"], b"true")


if __name__ == "__main__":
    unittest.main()
