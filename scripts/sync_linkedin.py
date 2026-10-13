"""Fetch approved LinkedIn Posts API content; write only a public preview feed."""

import json
import os
from pathlib import Path
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler


ENDPOINT = "https://api.linkedin.com/rest/posts"
OUTPUT = Path("assets/data/linkedin.json")


class SyncError(Exception):
    pass


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.blocked = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.blocked += 1
        elif tag in ("br", "p", "div"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.blocked:
            self.blocked -= 1

    def handle_data(self, data):
        if not self.blocked:
            self.parts.append(data)


def text(value, limit):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise SyncError("Unexpected text field in Posts API response.")
    parser = PlainText()
    parser.feed(value)
    parser.close()
    cleaned = "".join(parser.parts)
    cleaned = re.sub(r"@\[(.*?)\]\(urn:li:[^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]", "", cleaned)
    cleaned = cleaned.strip()
    return cleaned if len(cleaned) <= limit else cleaned[:limit - 3].rstrip() + "..."


def article_url(value):
    if not isinstance(value, str) or len(value) > 2048 or re.search(r"\s", value):
        return None
    try:
        parts = urlsplit(value)
        if (parts.scheme != "https" or not parts.hostname or parts.username
                or parts.password or parts.port not in (None, 443)):
            return None
        # Preview links do not need tracking parameters or fragments.
        return urlunsplit(("https", parts.netloc, parts.path, "", ""))
    except ValueError:
        return None


def public_post(post, author):
    if not isinstance(post, dict):
        raise SyncError("Unexpected post object in Posts API response.")
    distribution = post.get("distribution", {})
    if not isinstance(distribution, dict):
        raise SyncError("Unexpected distribution object in Posts API response.")
    if (post.get("author") != author or post.get("visibility") != "PUBLIC"
            or post.get("lifecycleState") != "PUBLISHED"
            or distribution.get("feedDistribution") != "MAIN_FEED"):
        return None
    urn = post.get("id", "")
    if not isinstance(urn, str) or not re.fullmatch(r"urn:li:(share|ugcPost):[0-9]+", urn):
        raise SyncError("Public post has an unsupported ID; no feed was published.")
    timestamp = post.get("publishedAt")
    if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)):
        raise SyncError("Public post is missing publishedAt; no feed was published.")
    try:
        published = datetime.fromtimestamp(timestamp / 1000, timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        raise SyncError("Public post has an invalid publishedAt timestamp.") from None
    content = post.get("content", {})
    if not isinstance(content, dict):
        raise SyncError("Unexpected content object in Posts API response.")
    article = content.get("article")
    if article is not None and not isinstance(article, dict):
        raise SyncError("Unexpected article object in Posts API response.")
    item = {
        "type": "article" if article is not None else "post",
        "title": text(article.get("title"), 180) if article else "",
        "text": text(post.get("commentary"), 1200),
        "publishedAt": published,
        "url": "https://www.linkedin.com/feed/update/" + urn + "/",
    }
    if article:
        item["description"] = text(article.get("description"), 500)
        source = article_url(article.get("source"))
        if source:
            item["articleUrl"] = source
    return item


def config(env):
    token = env.get("LINKEDIN_ACCESS_TOKEN", "").strip()
    author = env.get("LINKEDIN_AUTHOR_URN", "").strip()
    version = env.get("LINKEDIN_API_VERSION", "").strip()
    if not token or re.search(r"\s", token):
        raise SyncError("Set the LINKEDIN_ACCESS_TOKEN Actions secret to a valid access token.")
    if not re.fullmatch(r"urn:li:(person|organization):[A-Za-z0-9_-]+", author):
        raise SyncError("Set LINKEDIN_AUTHOR_URN to the app-authorized person or organization URN.")
    if not re.fullmatch(r"20[0-9]{2}(0[1-9]|1[0-2])", version):
        raise SyncError("Set LINKEDIN_API_VERSION to a supported YYYYMM version (see README).")
    try:
        count = int(env.get("LINKEDIN_MAX_POSTS", "") or "12")
    except ValueError:
        raise SyncError("LINKEDIN_MAX_POSTS must be an integer from 1 to 50.") from None
    if not 1 <= count <= 50:
        raise SyncError("LINKEDIN_MAX_POSTS must be an integer from 1 to 50.")
    return token, author, version, count


def request_page(url, token, version):
    request = Request(url, headers={
        "Authorization": "Bearer " + token,
        "LinkedIn-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
        "X-RestLi-Method": "FINDER",
        "Accept": "application/json",
    })
    try:
        with build_opener(NoRedirects()).open(request, timeout=30) as response:
            raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise SyncError("Posts API response exceeded the 5 MB safety limit.")
        return json.loads(raw)
    except HTTPError as error:
        error.close()
        hints = {
            401: "Access token expired or invalid; replace LINKEDIN_ACCESS_TOKEN.",
            403: "Verify approved r_member_social (or r_organization_social), token scope and author access.",
            429: "LinkedIn rate limit reached; rerun after the rate limit resets.",
        }
        raise SyncError(
            f"LinkedIn HTTP {error.code}. " + hints.get(
                error.code, "Check the supported API version, author URN and LinkedIn service status.")
        ) from None
    except (URLError, TimeoutError, OSError):
        raise SyncError("Could not reach LinkedIn; check connectivity and rerun the workflow.") from None
    except (ValueError, UnicodeError):
        raise SyncError("Posts API returned invalid JSON; no feed was published.") from None


def next_start(page, current):
    paging = page.get("paging")
    if not isinstance(paging, dict) or not isinstance(paging.get("links"), list):
        raise SyncError("Posts API response lacks valid paging.links; no feed was published.")
    links = [link for link in paging["links"] if isinstance(link, dict) and link.get("rel") == "next"]
    if not links:
        return None
    if len(links) != 1:
        raise SyncError("Posts API returned ambiguous pagination.")
    try:
        parts = urlsplit(links[0]["href"])
        if (parts.scheme != "https" or parts.netloc != "api.linkedin.com"
                or parts.path != "/rest/posts"):
            raise ValueError
        values = parse_qs(parts.query)["start"]
        if len(values) != 1:
            raise ValueError
        start = int(values[0])
        if start <= current:
            raise ValueError
        return start
    except (KeyError, ValueError, TypeError):
        raise SyncError("Posts API returned invalid pagination; no feed was published.") from None


def fetch_feed(token, author, version, count, fetch=request_page):
    items = {}
    start = 0
    for _ in range(10):
        url = ENDPOINT + "?" + urlencode({
            "q": "author", "author": author, "count": 100, "start": start,
            "sortBy": "CREATED", "viewContext": "READER",
        })
        page = fetch(url, token, version)
        if not isinstance(page, dict) or not isinstance(page.get("elements"), list):
            raise SyncError("Posts API response lacks elements; no feed was published.")
        for post in page["elements"]:
            item = public_post(post, author)
            if item:
                items[item["url"]] = item
        following = next_start(page, start)
        if len(items) >= count or following is None:
            return {
                "schemaVersion": 1,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "items": sorted(items.values(), key=lambda item: item["publishedAt"], reverse=True)[:count],
            }
        start = following
    raise SyncError("Reached the 10-page safety limit before filling the public feed; reduce LINKEDIN_MAX_POSTS.")


def sync(env, output=OUTPUT, fetch=request_page):
    feed = fetch_feed(*config(env), fetch=fetch)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(feed, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(f"Published {len(feed['items'])} public LinkedIn previews.")


if __name__ == "__main__":
    try:
        sync(os.environ)
    except SyncError as error:
        print(f"LinkedIn sync failed: {error}", file=sys.stderr)
        sys.exit(1)
