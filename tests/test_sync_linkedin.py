import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

from scripts import sync_linkedin as sync


AUTHOR = "urn:li:person:abc123"
ENV = {
    "LINKEDIN_ACCESS_TOKEN": "test-token",
    "LINKEDIN_AUTHOR_URN": AUTHOR,
    "LINKEDIN_API_VERSION": "202609",
}


def post(number=123, **fields):
    return {
        "id": f"urn:li:share:{number}",
        "author": AUTHOR,
        "visibility": "PUBLIC",
        "lifecycleState": "PUBLISHED",
        "distribution": {"feedDistribution": "MAIN_FEED"},
        "publishedAt": 1700000000000 + number,
        "commentary": "Public update",
        **fields,
    }


def page(posts, following=None):
    links = [] if following is None else [{
        "rel": "next",
        "href": f"https://api.linkedin.com/rest/posts?start={following}",
    }]
    return {"elements": posts, "paging": {"links": links}}


class FeedTests(unittest.TestCase):
    def test_config_requires_explicit_authorization_and_version(self):
        for key in ("LINKEDIN_ACCESS_TOKEN", "LINKEDIN_AUTHOR_URN", "LINKEDIN_API_VERSION"):
            env = dict(ENV)
            del env[key]
            with self.subTest(key=key), self.assertRaises(sync.SyncError):
                sync.config(env)
        for count in ("0", "51", "not-a-number"):
            with self.subTest(count=count), self.assertRaises(sync.SyncError):
                sync.config({**ENV, "LINKEDIN_MAX_POSTS": count})
        self.assertEqual(sync.config(ENV)[3], 12)

    def test_only_published_public_author_main_feed_posts(self):
        for fields in (
            {"visibility": "CONNECTIONS"},
            {"visibility": "LOGGED_IN"},
            {"lifecycleState": "DRAFT"},
            {"author": "urn:li:person:another"},
            {"distribution": {"feedDistribution": "NONE"}},
            {"distribution": {}},
        ):
            with self.subTest(fields=fields):
                self.assertIsNone(sync.public_post(post(**fields), AUTHOR))

    def test_minimal_sanitized_article(self):
        raw = post(commentary="<script>secret()</script><b>Hello</b> @[Mose](urn:li:person:abc123)\x00")
        raw["content"] = {"article": {
            "title": "<img src=x onerror=alert(1)>Article",
            "description": "<style>hidden</style>Public description",
            "source": "https://www.linkedin.com/pulse/article?tracking=secret#fragment",
            "thumbnail": "private-asset",
        }}
        raw["privateMetadata"] = "must-not-publish"
        item = sync.public_post(raw, AUTHOR)
        self.assertEqual(item, {
            "type": "article", "title": "Article", "text": "Hello Mose",
            "publishedAt": "2023-11-14T22:13:20.123000+00:00",
            "url": "https://www.linkedin.com/feed/update/urn:li:share:123/",
            "description": "Public description",
            "articleUrl": "https://www.linkedin.com/pulse/article",
        })
        self.assertNotIn("secret", json.dumps(item))
        self.assertNotIn("private", json.dumps(item))

    def test_preview_text_is_bounded(self):
        item = sync.public_post(post(commentary="x" * 2000), AUTHOR)
        self.assertEqual(len(item["text"]), 1200)
        self.assertTrue(item["text"].endswith("..."))

    def test_unsafe_article_links_are_omitted(self):
        for value in ("javascript:alert(1)", "http://example.org", "//example.org",
                      "https://user:password@example.org", "https://example.org:invalid",
                      "https://example.org:444", "https://example.org/\npath"):
            with self.subTest(value=value):
                self.assertIsNone(sync.article_url(value))

    def test_malformed_public_posts_fail(self):
        for fields in ({"id": "unknown"}, {"publishedAt": None},
                       {"publishedAt": True}, {"publishedAt": float("inf")},
                       {"commentary": {}}, {"content": []}, {"distribution": []}):
            with self.subTest(fields=fields), self.assertRaises(sync.SyncError):
                sync.public_post(post(**fields), AUTHOR)

    def test_pagination_continues_after_short_private_page(self):
        calls = []

        def fetch(url, token, version):
            calls.append(parse_qs(urlsplit(url).query))
            self.assertEqual(token, "test-token")
            self.assertEqual(version, "202609")
            if len(calls) == 1:
                return page([post(1, visibility="CONNECTIONS")], 100)
            return page([post(3), post(2), post(3)])

        feed = sync.fetch_feed(*sync.config(ENV), fetch=fetch)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["start"], ["100"])
        self.assertEqual(calls[0]["author"], [AUTHOR])
        self.assertEqual(calls[0]["viewContext"], ["READER"])
        self.assertEqual([item["url"].split(":")[-1] for item in feed["items"]], ["3/", "2/"])
        self.assertEqual(set(feed), {"schemaVersion", "updatedAt", "items"})

    def test_feed_limit_and_ugc_post_links(self):
        raw = post(2, id="urn:li:ugcPost:2")
        feed = sync.fetch_feed("token", AUTHOR, "202609", 1,
                               fetch=lambda *args: page([post(1), raw]))
        self.assertEqual(len(feed["items"]), 1)
        self.assertTrue(feed["items"][0]["url"].endswith("urn:li:ugcPost:2/"))

    def test_empty_feed_is_real_success(self):
        feed = sync.fetch_feed(*sync.config(ENV), fetch=lambda *args: page([]))
        self.assertEqual(feed["items"], [])

    def test_invalid_response_and_pagination_fail(self):
        invalid = [[], {}, {"elements": []}, {"elements": [], "paging": {"links": None}}]
        for href in ("https://attacker.test/rest/posts?start=100",
                     "https://api.linkedin.com/rest/posts?start=0",
                     "https://api.linkedin.com/rest/posts?start=x",
                     "https://api.linkedin.com/rest/posts?start=1&start=2"):
            invalid.append({"elements": [], "paging": {"links": [{"rel": "next", "href": href}]}})
        for response in invalid:
            with self.subTest(response=response), self.assertRaises(sync.SyncError):
                sync.fetch_feed(*sync.config(ENV), fetch=lambda *args: response)

    def test_page_limit_fails_instead_of_silently_truncating(self):
        def fetch(url, *args):
            start = int(parse_qs(urlsplit(url).query)["start"][0])
            return page([], start + 100)

        with self.assertRaisesRegex(sync.SyncError, "10-page"):
            sync.fetch_feed(*sync.config(ENV), fetch=fetch)

    def test_failure_preserves_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "linkedin.json"
            output.write_text("previous public feed", encoding="utf-8")
            with self.assertRaises(sync.SyncError):
                sync.sync(ENV, output, fetch=lambda *args: {})
            self.assertEqual(output.read_text(encoding="utf-8"), "previous public feed")
            sync.sync(ENV, output, fetch=lambda *args: page([post()]))
            self.assertEqual(len(json.loads(output.read_text())["items"]), 1)
            self.assertFalse(output.with_suffix(".json.tmp").exists())

    def test_http_errors_are_actionable_without_raw_response(self):
        for code, hint in ((401, "expired"), (403, "r_member_social"), (429, "rate limit"), (400, "API version")):
            error = HTTPError(sync.ENDPOINT, code, "secret-response", {}, None)
            with patch.object(sync, "build_opener") as opener:
                opener.return_value.open.side_effect = error
                with self.assertRaises(sync.SyncError) as caught:
                    sync.request_page(sync.ENDPOINT, "secret-token", "202609")
                self.assertIn(hint, str(caught.exception))
                self.assertNotIn("secret", str(caught.exception))

    def test_transport_error_does_not_log_request(self):
        with patch.object(sync, "build_opener") as opener:
            opener.return_value.open.side_effect = URLError("secret-token")
            with self.assertRaisesRegex(sync.SyncError, "connectivity"):
                sync.request_page(sync.ENDPOINT, "secret-token", "202609")

    def test_invalid_or_oversized_json_fails(self):
        for raw in (b"not JSON", b"x" * 5_000_001):
            with patch.object(sync, "build_opener") as opener:
                opener.return_value.open.return_value.__enter__.return_value.read.return_value = raw
                with self.assertRaises(sync.SyncError):
                    sync.request_page(sync.ENDPOINT, "secret-token", "202609")

    def test_request_headers_and_redirect_protection(self):
        with patch.object(sync, "build_opener") as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = b'{"elements":[]}'
            sync.request_page(sync.ENDPOINT, "secret-token", "202609")
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header("Authorization"), "Bearer secret-token")
            self.assertEqual(request.get_header("Linkedin-version"), "202609")
            self.assertEqual(request.get_header("X-restli-method"), "FINDER")
            self.assertIsInstance(opener.call_args.args[0], sync.NoRedirects)
            self.assertIsNone(sync.NoRedirects().redirect_request(None, None, 302, "", {}, "https://attacker.test"))


if __name__ == "__main__":
    unittest.main()
