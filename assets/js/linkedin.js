(function () {
  "use strict";

  var grid = document.getElementById("linkedin-grid");
  var status = document.getElementById("linkedin-status");
  var updated = document.getElementById("linkedin-updated");
  if (!grid || !status || !updated) return;

  function httpsUrl(value, postOnly) {
    if (typeof value !== "string") throw new Error("Invalid feed URL");
    var url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") ||
        (postOnly && (url.hostname !== "www.linkedin.com" ||
          !/^\/feed\/update\/urn:li:(share|ugcPost):[0-9]+\/$/.test(url.pathname) ||
          url.search || url.hash))) {
      throw new Error("Unsafe feed URL");
    }
    return url.href;
  }

  function date(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
      throw new Error("Invalid feed date");
    }
    return new Date(value);
  }

  function node(tag, className, content) {
    var element = document.createElement(tag);
    element.className = className;
    element.textContent = content;
    return element;
  }

  function link(label, url) {
    var element = node("a", "", label);
    element.href = url;
    element.target = "_blank";
    element.rel = "noopener noreferrer";
    return element;
  }

  function card(item) {
    if (!item || (item.type !== "post" && item.type !== "article") ||
        typeof item.title !== "string" || typeof item.text !== "string" ||
        (item.description !== undefined && typeof item.description !== "string")) {
      throw new Error("Invalid feed item");
    }
    var url = httpsUrl(item.url, true);
    var published = date(item.publishedAt);
    var article = node("article", "repo-card linkedin-card", "");
    var top = node("div", "repo-top", "");
    var title = node("h3", "linkedin-title", "");
    title.appendChild(link(item.title || (item.type === "article" ? "Article on LinkedIn" : "Post on LinkedIn"), url));
    top.appendChild(title);
    top.appendChild(node("span", "repo-flag", item.type === "article" ? "Article" : "Post"));
    article.appendChild(top);
    if (item.text) article.appendChild(node("p", "repo-desc linkedin-text", item.text));
    if (item.description) article.appendChild(node("p", "repo-desc", item.description));
    var time = node("time", "repo-meta", published.toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric"
    }));
    time.dateTime = published.toISOString();
    article.appendChild(time);
    var links = node("div", "repo-links", "");
    links.appendChild(link("Read on LinkedIn", url));
    if (item.articleUrl) links.appendChild(link("Read article", httpsUrl(item.articleUrl, false)));
    article.appendChild(links);
    return article;
  }

  fetch("assets/data/linkedin.json", { cache: "no-cache" }).then(function (response) {
    if (response.status === 404) throw new Error("not-configured");
    if (!response.ok) throw new Error("Feed request failed");
    return response.json();
  }).then(function (feed) {
    if (!feed || feed.schemaVersion !== 1 || !Array.isArray(feed.items) || feed.items.length > 50) {
      throw new Error("Invalid feed");
    }
    var synced = date(feed.updatedAt);
    var cards = feed.items.map(card);
    grid.replaceChildren.apply(grid, cards);
    status.hidden = cards.length > 0;
    status.textContent = cards.length ? "" : "No public LinkedIn posts are available yet.";
    var stale = Date.now() - synced.getTime() > 48 * 60 * 60 * 1000;
    updated.textContent = "Last synced " + synced.toLocaleString() +
      (stale ? " - updates are delayed; showing the last published feed." : "");
  }).catch(function (error) {
    grid.replaceChildren();
    updated.textContent = "";
    status.hidden = false;
    status.className = "state error";
    status.textContent = error.message === "not-configured"
      ? "LinkedIn updates are not connected yet. The site owner needs to complete the API sync setup."
      : "LinkedIn updates are temporarily unavailable. Please reload this page later.";
    console.error("LinkedIn feed could not be loaded:", error.message);
  }).finally(function () {
    grid.setAttribute("aria-busy", "false");
  });
})();
