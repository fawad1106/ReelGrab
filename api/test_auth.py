import os
import unittest
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")

from fastapi.testclient import TestClient
from main import app, is_supported_instagram_url


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

        with patch("main.download_record_insert", return_value=FakeResponse()), \
             patch("main.subprocess.run", side_effect=fake_run), \
             patch("main.upload_file"), \
             patch("main.create_signed_url", return_value="https://example.com/signed.mp4"), \
             patch("main.db_update"):
            response = client.post(
                "/api/download",
                json={"url": "https://www.instagram.com/reel/ABC123/"},
            )

        self.assertNotEqual(response.status_code, 401)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["file_url"], "https://example.com/signed.mp4")


if __name__ == "__main__":
    unittest.main()
