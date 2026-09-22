import os
import unittest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")

from main import hash_password, verify_password, new_session_token, SESSION_MAX_AGE


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

    def test_session_max_age_matches_familyflow_style(self):
        self.assertEqual(SESSION_MAX_AGE, 30 * 24 * 60 * 60)


if __name__ == "__main__":
    unittest.main()
