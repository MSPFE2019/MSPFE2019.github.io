# MSPFE2019.github.io

Personal portfolio landing page for **Mose Richardson (MSPFE2019)** — a self-contained static site
published with GitHub Pages. Repository cards are fetched live from the public GitHub REST
API at page load, so the site never needs to be updated when repositories change.
Public LinkedIn previews are fetched daily by a secret-backed GitHub Action, not by visitors' browsers.

## Structure

```
index.html            Landing page markup (hero, focus areas, repositories, attribution)
build.html            Walkthrough for recreating the portfolio with GitHub Copilot
assets/css/styles.css Responsive Microsoft-inspired theme with light/dark support
assets/js/app.js      GitHub feed plus canvas, reveal, tilt and theme interactions
assets/js/guide.js    Theme, reveal and scroll behavior for the build walkthrough
assets/js/rain.js     Digital code-rain background shared by both pages
assets/js/linkedin.js Public LinkedIn feed renderer (no credentials)
scripts/sync_linkedin.py Approved LinkedIn API fetcher and public-feed sanitizer
tests/               Dependency-free Python and Node feed tests
.github/workflows/linkedin-pages.yml Daily sync and static Pages deployment
.nojekyll             Serve files as-is (no Jekyll processing)
```

## Repository feed

- Source: `GET https://api.github.com/users/MSPFE2019/repos?per_page=100&sort=updated` (paginated, unauthenticated).
- Each card shows name, description, topics, language (with colour dot), stars, forks,
  relative updated date, a link to the code, and a live-demo link when `homepage` is set.
- Controls: text search (name/description/topics/language), language filter, sort
  (recently updated, most stars, name, newest), and a hide-forks toggle.
- States: skeleton loading placeholders, empty account, no-search-results, and an error
  state with a retry button (rate limit, offline and 404 are reported distinctly).
- Results are cached in `localStorage` for 30 minutes; **Refresh** forces a re-fetch, and a
  stale cache is used as a fallback if a request fails.

Unauthenticated GitHub API calls are limited to 60 requests/hour per IP; the cache keeps
normal browsing well under that.

## Interaction and accessibility

- The hero includes a pointer-reactive canvas network and animated capability nodes.
- Focus and repository cards use subtle pointer tilt and spotlight effects.
- Sections reveal as they enter the viewport, with a page scroll-progress indicator.
- A header control toggles light/dark themes and remembers the preference locally.
- All motion is disabled automatically when `prefers-reduced-motion` is enabled.
- Both pages use a green-on-dark digital-terminal aesthetic by default, with optional
  light mode. Code rain stops when the tab is hidden and respects reduced motion.

## Local preview

```bash
python -m http.server 8080
# then open http://localhost:8080
```

## Deployment

The repository previously used **Deploy from a branch** (`main`, root). To enable the
LinkedIn integration, change **Settings > Pages > Build and deployment > Source** to
**GitHub Actions**. The `Sync LinkedIn and deploy Pages` workflow publishes the existing
static HTML/CSS/JS plus a freshly generated `assets/data/linkedin.json` to
`https://mspfe2019.github.io`. No bot commits, PAT, or source-code write permissions are
needed. Only root HTML files, `.nojekyll`, and `assets/` enter the Pages artifact.

The workflow runs daily at **08:17 UTC**, on relevant changes pushed to `main`, and via
**Actions > Sync LinkedIn and deploy Pages > Run workflow**. Scheduled runs use the default
branch, can be delayed, and GitHub may disable schedules on inactive public repositories.
The `github-pages` environment must allow deployments from `main`; manual production runs
should also use `main`. All deployments share one concurrency group.

### LinkedIn API prerequisites and setup

This integration uses the documented
[Posts API author finder](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api#find-posts-by-authors):

```text
GET https://api.linkedin.com/rest/posts?q=author&author={encoded-URN}&count=100&start=0&sortBy=CREATED&viewContext=READER
Authorization: Bearer {token}
LinkedIn-Version: {supported-YYYYMM}
X-Restli-Protocol-Version: 2.0.0
X-RestLi-Method: FINDER
```

**Approved API access must specifically cover reading this author's posts.** For a personal
feed, the app and authorizing member need the restricted **`r_member_social`** permission.
`w_member_social`, OpenID Connect sign-in, and ordinary Share on LinkedIn access do **not**
grant personal-post reading. For an organization feed, use **`r_organization_social`**
and an authorizing member with a supported page role (see the linked API permission table).
Confirm your LinkedIn-approved product/tier supports the author finder, public website
display, and the storage/retention used here under your LinkedIn agreement.

1. In the approved LinkedIn app, complete the
   [three-legged OAuth authorization-code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
   outside this repository, requesting the required read scope. Authorize the member
   whose posts will appear (or the member managing the organization). Never paste tokens,
   authorization codes, refresh tokens, or client secrets into issues, code, or workflow inputs.
2. Obtain the app-authorized author URN: `urn:li:person:{id}` or
   `urn:li:organization:{id}`. Use the identity returned by the APIs your app is approved
   for, following the Posts API's linked profile/organization-access documentation. A
   profile vanity slug is **not** the person ID; do not assume an OIDC subject is interchangeable.
3. Under **Settings > Secrets and variables > Actions**, configure:

| Kind | Name | Value |
|---|---|---|
| Repository secret | `LINKEDIN_ACCESS_TOKEN` | OAuth access token with the approved read scope, without the `Bearer ` prefix |
| Repository variable | `LINKEDIN_AUTHOR_URN` | App-authorized person or organization URN |
| Repository variable | `LINKEDIN_API_VERSION` | Supported LinkedIn Marketing API version in `YYYYMM` format; `202609` is documented as supported as of October 2026 |
| Repository variable (optional) | `LINKEDIN_MAX_POSTS` | Number of recent previews, `1` to `50`; default `12` |

4. Select **GitHub Actions** as the Pages source, merge the integration to `main`, then
   manually run the workflow and check the fetch/deploy logs. There is deliberately no
   committed sample feed; until the first successful deployment the page reports that
   LinkedIn is not connected.

This workflow only reads with an access token; it does **not** need a client secret and
does **not** automatically refresh tokens. Rotate `LINKEDIN_ACCESS_TOKEN` before its
OAuth `expires_in` deadline. Programmatic refresh is available only for eligible apps;
do not assume your app has it. If you later implement refresh, keep any
`LINKEDIN_CLIENT_SECRET` and `LINKEDIN_REFRESH_TOKEN` exclusively in Actions secrets as well.
Keep `LINKEDIN_API_VERSION` current with
[LinkedIn's supported versions](https://learn.microsoft.com/en-us/linkedin/marketing/versioning);
sunset versions will fail rather than falling back to an undocumented endpoint.

### What gets published

Each run replaces the feed with recent **`PUBLIC`, `PUBLISHED`, `MAIN_FEED`** posts from
the configured author. Connections-only, logged-in-only, draft and dark/sponsored-only
posts are excluded. It follows the API's next-page links even when a page is short,
deduplicates posts, and scans at most ten pages to fill the requested preview count.
A continued feed beyond that safety limit without enough public posts is a CI failure,
not a silently incomplete result. This is a recent feed, not a full historical archive.

The JSON contains only a schema version, sync timestamp and previews: type, bounded
plain-text title/commentary/description, publication date, public LinkedIn post link,
and an optional HTTPS article link with tracking query/fragment removed. It excludes
raw API responses, author identifiers as separate fields, images, private metadata,
engagement analytics and credentials. LinkedIn post IDs occur only in public permalinks.
The browser creates text nodes, never API-sourced HTML, and never contacts the authenticated
LinkedIn endpoint.

**Articles means article previews returned as `content.article` in the Posts API.**
This endpoint does not promise a separate enumeration of all long-form articles or
newsletters, nor full article bodies. Native articles appear only if LinkedIn exposes
them through this author's returned posts; visitors follow the public links to read more.
The integration does not scrape LinkedIn or invent an articles endpoint.

On invalid configuration, expired tokens (401), insufficient scope/author access (403),
rate limits (429), malformed responses, or network errors, the workflow fails with a
useful message and does not deploy. It never logs access tokens or raw API response bodies.
The previously deployed site remains available; its last-sync timestamp explicitly marks
feeds older than 48 hours as delayed. API-returned empty public feeds are a valid empty
state, not a fabricated fallback. A successful later sync removes disappeared/non-public
posts from this recent feed. Failed runs cannot remove previously public content: for an
urgent privacy deletion, disable the workflow and remove the existing Pages deployment
through repository settings rather than waiting for a token fix.

Feed data is generated only on the Actions runner and is not committed. The uploaded
Pages artifact requests one-day retention, but the live site remains public until its
deployment is replaced or removed; follow your approved LinkedIn retention requirements.

### Focused validation

No third-party packages are required (Python 3.12+ and Node 22+):

```text
python -m unittest discover -s tests -p "test_*.py"
node --test tests/linkedin.test.cjs
```

These use synthetic responses, not real account content or credentials. They cover public-only
filtering, sanitization, pagination, output limits, failure preservation, request headers,
error messages, text-safe rendering, empty/unconfigured/error states and stale-feed notices.

## Customising

- Change the account: update `USER` at the top of `assets/js/app.js`.
- Change the palette: edit the CSS custom properties in `:root` (and the dark-scheme block)
  in `assets/css/styles.css`.
- Edit copy: the hero, focus cards and attribution section are static markup in `index.html`.
