import os
import unittest
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")

from fastapi.testclient import TestClient
from main import app, is_supported_instagram_url, is_supported_youtube_url


class ReelGrabTests(unittest.TestCase):
    def test_health_endpoint_is_public(self):
        client = TestClient(app)
        response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_instagram_url_validation(self):
        self.assertTrue(is_supported_instagram_url("https://www.instagram.com/reel/ABC123/"))
        self.assertTrue(is_supported_instagram_url("https://www.instagram.com/p/ABC123/"))
        self.assertFalse(is_supported_instagram_url("https://example.com/video/ABC123"))

    def test_youtube_url_validation(self):
        self.assertTrue(is_supported_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        self.assertTrue(is_supported_youtube_url("https://youtu.be/dQw4w9WgXcQ"))
        self.assertTrue(is_supported_youtube_url("https://www.youtube.com/shorts/abc123"))
        self.assertFalse(is_supported_youtube_url("https://example.com/watch?v=abc"))

    def test_download_endpoint_does_not_require_login(self):
        client = TestClient(app)

        class FakeResponse:
            status_code = 201

            def json(self):
                return [{"id": "download-test"}]

        class FakeCompleted:
            returncode = 0
            stderr = ""

        def fake_run(command, **kwargs):
            output_template = command[command.index("-o") + 1]
            output_path = output_template.replace("%(id)s", "download-test").replace("%(ext)s", "mp4")
            with open(output_path, "wb") as fh:
                fh.write(b"fake mp4")
            return FakeCompleted()

        with patch("main.download_record_insert", return_value=FakeResponse()),              patch("main.subprocess.run", side_effect=fake_run),              patch("main.upload_file"),              patch("main.create_signed_url", return_value="https://example.com/signed.mp4"),              patch("main.db_update"):
            response = client.post(
                "/api/download",
                json={"url": "https://www.instagram.com/reel/ABC123/"},
            )

        self.assertNotEqual(response.status_code, 401)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["file_url"], "https://example.com/signed.mp4")

    def test_youtube_download_retries_with_compatible_client_when_primary_fails(self):
        client = TestClient(app)

        class FakeResponse:
            status_code = 201

            def json(self):
                return [{"id": "youtube-fallback-test"}]

        calls = []

        class FakeCompleted:
            returncode = 0
            stderr = ""

        def fake_run(command, **kwargs):
            calls.append(command)
            output_template = command[command.index("-o") + 1]
            output_path = output_template.replace("%(id)s", "youtube-fallback-test").replace("%(ext)s", "mp4")
            if len(calls) == 1:
                return type("Failed", (), {
                    "returncode": 1,
                    "stderr": "HTTP Error 403: Forbidden"
                })()
            with open(output_path, "wb") as fh:
                fh.write(b"fallback mp4")
            return FakeCompleted()

        with patch("main.download_record_insert", return_value=FakeResponse()), \
             patch("main.subprocess.run", side_effect=fake_run), \
             patch("main.upload_file"), \
             patch("main.create_signed_url", return_value="https://example.com/fallback.mp4"), \
             patch("main.db_update"):
            response = client.post(
                "/api/download",
                json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(calls), 2)
        self.assertIn("--extractor-args", calls[1])
        self.assertIn("youtube:player_client=web_embedded", calls[1])
        self.assertEqual(response.json()["file_url"], "https://example.com/fallback.mp4")

    def test_instagram_download_retries_with_simple_mp4_when_primary_fails(self):
        client = TestClient(app)

        class FakeResponse:
            status_code = 201
            def json(self):
                return [{"id": "instagram-fallback-test"}]

        calls = []
        def fake_run(command, **kwargs):
            calls.append(command)
            if len(calls) == 1:
                return type("Failed", (), {"returncode": 1, "stderr": "format unavailable"})()
            output_template = command[command.index("-o") + 1]
            output_path = output_template.replace("%(id)s", "instagram-fallback-test").replace("%(ext)s", "mp4")
            with open(output_path, "wb") as fh:
                fh.write(b"fallback mp4")
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch("main.download_record_insert", return_value=FakeResponse()),              patch("main.subprocess.run", side_effect=fake_run),              patch("main.upload_file"),              patch("main.create_signed_url", return_value="https://example.com/instagram.mp4"),              patch("main.db_update"):
            response = client.post(
                "/api/download",
                json={"url": "https://www.instagram.com/reel/ABC123/"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(calls), 2)
        self.assertIn("best[ext=mp4]/best", calls[1])
        self.assertNotIn("--extractor-args", calls[1])
        self.assertEqual(response.json()["file_url"], "https://example.com/instagram.mp4")

    def test_youtube_download_is_accepted(self):
        client = TestClient(app)

        class FakeResponse:
            status_code = 201

            def json(self):
                return [{"id": "youtube-test"}]

        class FakeCompleted:
            returncode = 0
            stderr = ""

        def fake_run(command, **kwargs):
            output_template = command[command.index("-o") + 1]
            output_path = output_template.replace("%(id)s", "youtube-test").replace("%(ext)s", "mp4")
            with open(output_path, "wb") as fh:
                fh.write(b"fake youtube mp4")
            self.assertIn("https://www.youtube.com/watch?v=dQw4w9WgXcQ", command)
            return FakeCompleted()

        with patch("main.download_record_insert", return_value=FakeResponse()),              patch("main.subprocess.run", side_effect=fake_run),              patch("main.upload_file"),              patch("main.create_signed_url", return_value="https://example.com/youtube.mp4"),              patch("main.db_update"):
            response = client.post(
                "/api/download",
                json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["file_url"], "https://example.com/youtube.mp4")


if __name__ == "__main__":
    unittest.main()
