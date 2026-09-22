# MSPFE2019.github.io

Personal portfolio landing page for **Mose (MSPFE2019)** — a self-contained static site
published with GitHub Pages. Repository cards are fetched live from the public GitHub REST
API at page load, so the site never needs to be updated when repositories change.

## Structure

```
index.html            Landing page markup (hero, focus areas, repositories, attribution)
build.html            Walkthrough for recreating the portfolio with GitHub Copilot
assets/css/styles.css Responsive Microsoft-inspired theme with light/dark support
assets/js/app.js      GitHub feed plus canvas, reveal, tilt and theme interactions
assets/js/guide.js    Theme, reveal and scroll behavior for the build walkthrough
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

## Local preview

```bash
python -m http.server 8080
# then open http://localhost:8080
```

## Deployment

GitHub Pages serves this repository from the default branch root. Because the site is plain
HTML/CSS/JS there is no build step — merging to `main` publishes to
`https://mspfe2019.github.io`.

## Customising

- Change the account: update `USER` at the top of `assets/js/app.js`.
- Change the palette: edit the CSS custom properties in `:root` (and the dark-scheme block)
  in `assets/css/styles.css`.
- Edit copy: the hero, focus cards and attribution section are static markup in `index.html`.
