/* Portfolio repository feed — fetches public repos for the configured GitHub user
   at runtime and renders filterable cards with loading / empty / error states. */
(function () {
  "use strict";

  var USER = "MSPFE2019";
  var API = "https://api.github.com";
  var PER_PAGE = 100;
  var MAX_PAGES = 5;
  var CACHE_KEY = "mspfe2019-repos-v1";
  var CACHE_TTL_MS = 30 * 60 * 1000;

  var el = {
    grid: document.getElementById("repo-grid"),
    status: document.getElementById("repo-status"),
    search: document.getElementById("search"),
    language: document.getElementById("language"),
    sort: document.getElementById("sort"),
    hideForks: document.getElementById("hide-forks"),
    count: document.getElementById("result-count"),
    refresh: document.getElementById("refresh"),
    stats: document.getElementById("profile-stats"),
    year: document.getElementById("year"),
    themeToggle: document.getElementById("theme-toggle"),
    scrollProgress: document.getElementById("scroll-progress"),
    heroVisual: document.getElementById("hero-visual"),
    heroCanvas: document.getElementById("hero-canvas")
  };

  var repos = [];

  if (el.year) el.year.textContent = String(new Date().getFullYear());
  restoreTheme();
  initMotion();

  /* ---------- helpers ---------- */

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function compact(n) {
    if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + "k";
    return String(n);
  }

  function relativeDate(iso) {
    var then = new Date(iso).getTime();
    if (isNaN(then)) return "unknown";
    var days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return days + " days ago";
    var months = Math.floor(days / 30);
    if (months < 12) return months + (months === 1 ? " month ago" : " months ago");
    var years = Math.floor(months / 12);
    return years + (years === 1 ? " year ago" : " years ago");
  }

  function absoluteDate(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }

  function showState(kind, title, message, withRetry) {
    el.grid.innerHTML = "";
    el.grid.setAttribute("aria-busy", "false");
    el.status.hidden = false;
    el.status.className = "state" + (kind === "error" ? " error" : "");
    el.status.innerHTML =
      "<h3>" + esc(title) + "</h3><p>" + esc(message) + "</p>" +
      (withRetry ? '<button class="btn btn-primary" type="button" id="retry">Try again</button>' : "");
    var retry = document.getElementById("retry");
    if (retry) retry.addEventListener("click", function () { load(true); });
  }

  function hideState() {
    el.status.hidden = true;
    el.status.innerHTML = "";
  }

  function showSkeletons() {
    hideState();
    el.grid.setAttribute("aria-busy", "true");
    var html = "";
    for (var i = 0; i < 6; i++) {
      html += '<div class="repo-card skeleton"><span></span><span></span><span></span></div>';
    }
    el.grid.innerHTML = html;
    el.count.textContent = "Loading repositories…";
  }

  /* ---------- data ---------- */

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.repos)) return null;
      if (Date.now() - parsed.time > CACHE_TTL_MS) return null;
      return parsed.repos;
    } catch (e) {
      return null;
    }
  }

  function writeCache(list) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), repos: list }));
    } catch (e) { /* storage unavailable or full — non-fatal */ }
  }

  function fetchPage(page) {
    var url = API + "/users/" + USER + "/repos?per_page=" + PER_PAGE + "&sort=updated&page=" + page;
    return fetch(url, { headers: { Accept: "application/vnd.github+json" } }).then(function (res) {
      if (res.status === 403 || res.status === 429) {
        throw new Error("rate-limit");
      }
      if (res.status === 404) {
        throw new Error("not-found");
      }
      if (!res.ok) {
        throw new Error("http-" + res.status);
      }
      return res.json();
    });
  }

  function fetchAll() {
    var collected = [];

    function next(page) {
      return fetchPage(page).then(function (batch) {
        collected = collected.concat(batch);
        if (batch.length === PER_PAGE && page < MAX_PAGES) return next(page + 1);
        return collected;
      });
    }

    return next(1);
  }

  function load(force) {
    showSkeletons();

    var cached = force ? null : readCache();
    if (cached) {
      apply(cached);
      return;
    }

    fetchAll().then(function (list) {
      writeCache(list);
      apply(list);
    }).catch(function (err) {
      var stale = readCache();
      if (stale && stale.length) {
        apply(stale);
        return;
      }
      var message = "Something went wrong while contacting the GitHub API. Please try again in a moment.";
      if (err && err.message === "rate-limit") {
        message = "GitHub's unauthenticated API rate limit was reached. It resets within the hour — please try again then.";
      } else if (err && err.message === "not-found") {
        message = "The GitHub account \u201c" + USER + "\u201d could not be found.";
      } else if (!navigator.onLine) {
        message = "You appear to be offline. Reconnect and try again.";
      }
      showState("error", "Couldn't load repositories", message, true);
    });
  }

  function apply(list) {
    repos = (list || []).filter(function (r) { return r && !r.private; });
    populateLanguages();
    renderStats();
    render();
  }

  /* ---------- rendering ---------- */

  function populateLanguages() {
    var seen = {};
    repos.forEach(function (r) { if (r.language) seen[r.language] = true; });
    var langs = Object.keys(seen).sort();
    var current = el.language.value;
    el.language.innerHTML = '<option value="">All languages</option>' +
      langs.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + "</option>"; }).join("");
    if (current && langs.indexOf(current) !== -1) el.language.value = current;
  }

  function renderStats() {
    if (!el.stats) return;
    var stars = repos.reduce(function (sum, r) { return sum + (r.stargazers_count || 0); }, 0);
    var langs = {};
    repos.forEach(function (r) { if (r.language) langs[r.language] = true; });
    set("repos", String(repos.length));
    set("stars", compact(stars));
    set("languages", String(Object.keys(langs).length));

    function set(key, value) {
      var node = el.stats.querySelector('[data-stat="' + key + '"]');
      if (node) node.textContent = value;
    }
  }

  function filtered() {
    var q = el.search.value.trim().toLowerCase();
    var lang = el.language.value;
    var hideForks = el.hideForks.checked;

    var list = repos.filter(function (r) {
      if (hideForks && r.fork) return false;
      if (lang && r.language !== lang) return false;
      if (!q) return true;
      var haystack = [r.name, r.description, r.language]
        .concat(r.topics || [])
        .join(" ")
        .toLowerCase();
      return haystack.indexOf(q) !== -1;
    });

    var mode = el.sort.value;
    list.sort(function (a, b) {
      if (mode === "stars") return (b.stargazers_count || 0) - (a.stargazers_count || 0);
      if (mode === "name") return a.name.localeCompare(b.name);
      if (mode === "created") return new Date(b.created_at) - new Date(a.created_at);
      return new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at);
    });

    return list;
  }

  function card(r) {
    var topics = (r.topics || []).slice(0, 4);
    var updated = r.pushed_at || r.updated_at;

    return '<article class="repo-card">' +
      '<div class="repo-top">' +
        '<a class="repo-name" href="' + esc(r.html_url) + '" target="_blank" rel="noopener">' + esc(r.name) + "</a>" +
        (r.fork ? '<span class="repo-flag">Fork</span>' : (r.archived ? '<span class="repo-flag">Archived</span>' : "")) +
      "</div>" +
      (r.description
        ? '<p class="repo-desc">' + esc(r.description) + "</p>"
        : '<p class="repo-desc muted">No description provided.</p>') +
      (topics.length
        ? '<div class="repo-topics">' + topics.map(function (t) { return '<span class="topic">' + esc(t) + "</span>"; }).join("") + "</div>"
        : "") +
      '<div class="repo-meta">' +
        (r.language
          ? '<span><span class="dot"></span>' + esc(r.language) + "</span>"
          : "") +
        '<span title="Stars">&#9733; ' + compact(r.stargazers_count || 0) + "</span>" +
        '<span title="Forks">&#9282; ' + compact(r.forks_count || 0) + "</span>" +
        '<span title="Last updated ' + esc(absoluteDate(updated)) + '">Updated ' + esc(relativeDate(updated)) + "</span>" +
      "</div>" +
      '<div class="repo-links">' +
        '<a href="' + esc(r.html_url) + '" target="_blank" rel="noopener">Code</a>' +
        (r.homepage ? '<a href="' + esc(r.homepage) + '" target="_blank" rel="noopener">Live demo</a>' : "") +
      "</div>" +
    "</article>";
  }

  function render() {
    var list = filtered();
    el.grid.setAttribute("aria-busy", "false");

    if (!repos.length) {
      el.count.textContent = "";
      showState("empty", "No public repositories yet", "This account has no public repositories to display right now.", true);
      return;
    }

    if (!list.length) {
      el.count.textContent = "";
      showState("empty", "No matching repositories", "Try a different search term, language or clear the fork filter.", false);
      return;
    }

    hideState();
    el.count.textContent = "Showing " + list.length + " of " + repos.length + " repositories";
    el.grid.innerHTML = list.map(card).join("");
    initTilt(el.grid.querySelectorAll(".repo-card"));
  }

  /* ---------- events ---------- */

  function debounce(fn, wait) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  el.search.addEventListener("input", debounce(render, 160));
  el.language.addEventListener("change", render);
  el.sort.addEventListener("change", render);
  el.hideForks.addEventListener("change", render);
  if (el.refresh) el.refresh.addEventListener("click", function () { load(true); });

  load(false);

  /* ---------- interactive presentation ---------- */

  function restoreTheme() {
    try {
      var saved = localStorage.getItem("mose-theme");
      if (saved === "light" || saved === "dark") {
        document.documentElement.setAttribute("data-theme", saved);
      }
    } catch (e) { /* localStorage is optional */ }
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme");
    var next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("mose-theme", next); } catch (e) { /* non-fatal */ }
    window.dispatchEvent(new Event("themechange"));
  }

  function initMotion() {
    if (el.themeToggle) el.themeToggle.addEventListener("click", toggleTheme);

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var revealItems = document.querySelectorAll(".reveal");
    if (reduceMotion || !("IntersectionObserver" in window)) {
      revealItems.forEach(function (item) { item.classList.add("is-visible"); });
    } else {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.14 });
      revealItems.forEach(function (item, index) {
        item.style.transitionDelay = Math.min(index % 4, 3) * 70 + "ms";
        observer.observe(item);
      });
    }

    window.addEventListener("scroll", updateScrollProgress, { passive: true });
    updateScrollProgress();
    initTilt(document.querySelectorAll(".tilt-card"));
    if (!reduceMotion) initHeroGraphic();
  }

  function updateScrollProgress() {
    if (!el.scrollProgress) return;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var ratio = max > 0 ? window.scrollY / max : 0;
    el.scrollProgress.style.width = Math.max(0, Math.min(100, ratio * 100)) + "%";
  }

  function initTilt(nodes) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.dataset.tiltReady) return;
      node.dataset.tiltReady = "true";
      node.addEventListener("pointermove", function (event) {
        var rect = node.getBoundingClientRect();
        var x = (event.clientX - rect.left) / rect.width;
        var y = (event.clientY - rect.top) / rect.height;
        var rotateX = (0.5 - y) * 5;
        var rotateY = (x - 0.5) * 5;
        node.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
        node.style.setProperty("--my", (y * 100).toFixed(1) + "%");
        node.style.transform = "perspective(900px) rotateX(" + rotateX.toFixed(2) + "deg) rotateY(" + rotateY.toFixed(2) + "deg) translateY(-3px)";
      });
      node.addEventListener("pointerleave", function () {
        node.style.transform = "";
      });
    });
  }

  function initHeroGraphic() {
    if (!el.heroCanvas || !el.heroVisual) return;
    var canvas = el.heroCanvas;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var pointer = { x: 0.5, y: 0.5, active: false };
    var particles = Array.from({ length: 32 }, function (_, index) {
      return {
        x: ((index * 47) % 101) / 100,
        y: ((index * 71) % 97) / 96,
        vx: ((index % 5) - 2) * 0.00012,
        vy: (((index * 3) % 5) - 2) * 0.00012,
        size: 1 + (index % 3)
      };
    });

    function resize() {
      var rect = el.heroVisual.getBoundingClientRect();
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function themeColor(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function frame() {
      var width = canvas.clientWidth;
      var height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);
      var accent = themeColor("--cp-accent");
      var border = themeColor("--cp-border");

      particles.forEach(function (particle) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (particle.x < 0 || particle.x > 1) particle.vx *= -1;
        if (particle.y < 0 || particle.y > 1) particle.vy *= -1;

        if (pointer.active) {
          var pdx = pointer.x - particle.x;
          var pdy = pointer.y - particle.y;
          var distance = Math.sqrt(pdx * pdx + pdy * pdy);
          if (distance < 0.2 && distance > 0.01) {
            particle.x -= pdx * 0.0012;
            particle.y -= pdy * 0.0012;
          }
        }
      });

      for (var i = 0; i < particles.length; i++) {
        for (var j = i + 1; j < particles.length; j++) {
          var a = particles[i];
          var b = particles[j];
          var dx = (a.x - b.x) * width;
          var dy = (a.y - b.y) * height;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < 92) {
            ctx.globalAlpha = (1 - d / 92) * 0.45;
            ctx.strokeStyle = border;
            ctx.beginPath();
            ctx.moveTo(a.x * width, a.y * height);
            ctx.lineTo(b.x * width, b.y * height);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = i % 4 === 0 ? accent : border;
        ctx.beginPath();
        ctx.arc(particles[i].x * width, particles[i].y * height, particles[i].size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }

    el.heroVisual.addEventListener("pointermove", function (event) {
      var rect = el.heroVisual.getBoundingClientRect();
      pointer.x = (event.clientX - rect.left) / rect.width;
      pointer.y = (event.clientY - rect.top) / rect.height;
      pointer.active = true;
      var nodes = el.heroVisual.querySelectorAll(".orbit-node");
      nodes.forEach(function (node) {
        var nodeRect = node.getBoundingClientRect();
        var cx = nodeRect.left + nodeRect.width / 2;
        var cy = nodeRect.top + nodeRect.height / 2;
        var distance = Math.hypot(event.clientX - cx, event.clientY - cy);
        node.classList.toggle("is-active", distance < 90);
      });
    });
    el.heroVisual.addEventListener("pointerleave", function () {
      pointer.active = false;
      el.heroVisual.querySelectorAll(".orbit-node").forEach(function (node) {
        node.classList.remove("is-active");
      });
    });
    window.addEventListener("resize", resize);
    window.addEventListener("themechange", resize);
    resize();
    frame();
  }
})();
