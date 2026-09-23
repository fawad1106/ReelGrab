import os
import unittest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")

from fastapi import HTTPException
from fastapi.testclient import TestClient
from main import (
    Credentials,
    hash_password,
    new_session_token,
    SESSION_MAX_AGE,
    validate_credentials,
    verify_password,
    app,
)


class AuthSecurityTests(unittest.TestCase):
    def test_password_hash_round_trip(self):
        stored = hash_password("correct horse battery staple")
        self.assertNotEqual(stored, "correct horse battery staple")
        self.assertTrue(verify_password("correct horse battery staple", stored))
        self.assertFalse(verify_password("wrong password", stored))

    def test_session_tokens_are_random_and_url_safe(self):
        first = new_session_token()
        second = new_session_token()
        self.assertNotEqual(first, second)
        self.assertGreaterEqual(len(first), 64)
        self.assertNotIn("/", first)
        self.assertNotIn("+", first)

    def test_only_fawad_malik_is_an_admin(self):
        from main import is_admin_user
        self.assertTrue(is_admin_user({"username": "fawad malik"}))
        self.assertTrue(is_admin_user({"username": "Fawad Malik"}))
        self.assertFalse(is_admin_user({"username": "someone else"}))

    def test_session_max_age_matches_familyflow_style(self):
        self.assertEqual(SESSION_MAX_AGE, 30 * 24 * 60 * 60)

    def test_render_frontend_origins_are_allowed_by_cors(self):
        client = TestClient(app)
        response = client.options(
            "/api/auth/login",
            headers={
                "Origin": "https://reelgrab-preview.onrender.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "https://reelgrab-preview.onrender.com")
        self.assertEqual(response.headers.get("access-control-allow-credentials"), "true")

    def test_registration_requires_valid_email(self):
        with self.assertRaises(HTTPException):
            validate_credentials(
                Credentials(username="izunay", password="password123", email=""),
                require_email=True,
            )

    def test_registration_rejects_malformed_email(self):
        with self.assertRaises(HTTPException):
            validate_credentials(
                Credentials(username="izunay", password="password123", email="not-an-email"),
                require_email=True,
            )

    def test_registration_rejects_email_without_dot_domain(self):
        with self.assertRaises(HTTPException):
            validate_credentials(
                Credentials(username="izunay", password="password123", email="izunay@example"),
                require_email=True,
            )

    def test_registration_accepts_valid_email(self):
        username, email = validate_credentials(
            Credentials(username="Izunay", password="password123", email="izunay@example.com"),
            require_email=True,
        )
        self.assertEqual(username, "izunay")
        self.assertEqual(email, "izunay@example.com")

    def test_registration_accepts_familyflow_style_username_with_spaces(self):
        username, email = validate_credentials(
            Credentials(username="Fawad Malik", password="password123", email="fawad@example.com"),
            require_email=True,
        )
        self.assertEqual(username, "fawad malik")
        self.assertEqual(email, "fawad@example.com")


if __name__ == "__main__":
    unittest.main()
