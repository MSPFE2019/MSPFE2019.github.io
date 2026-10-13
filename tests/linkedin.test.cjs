const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const script = readFileSync(join(__dirname, "..", "assets", "js", "linkedin.js"), "utf8");

class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.textContent = "";
    this.attributes = {};
    this.hidden = false;
  }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  set innerHTML(value) { throw new Error("Feed must not use HTML injection"); }
}

function feed(items = []) {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), items };
}

function item(fields = {}) {
  return {
    type: "post", title: "", text: "Hello",
    publishedAt: "2026-10-01T12:00:00+00:00",
    url: "https://www.linkedin.com/feed/update/urn:li:share:123/",
    ...fields
  };
}

async function render(data, statusCode = 200, networkError = false) {
  const elements = Object.fromEntries(["linkedin-grid", "linkedin-status", "linkedin-updated"]
    .map(id => [id, new Element()]));
  const errors = [];
  const requests = [];
  vm.runInNewContext(script, {
    document: {
      getElementById: id => elements[id],
      createElement: tag => new Element(tag)
    },
    URL, Date, Number,
    console: { error: (...args) => errors.push(args) },
    fetch: async (...args) => {
      requests.push(args);
      if (networkError) throw new Error("offline");
      return { status: statusCode, ok: statusCode === 200, json: async () => data };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  return { elements, errors, requests };
}

function allNodes(element) {
  return [element, ...element.children.flatMap(allNodes)];
}

test("renders public article previews as text and secure links", async () => {
  const malicious = '<img src=x onerror="alert(1)">';
  const { elements, errors, requests } = await render(feed([item({
    type: "article", title: malicious, text: malicious, description: "Preview",
    articleUrl: "https://www.linkedin.com/pulse/example"
  })]));
  const grid = elements["linkedin-grid"];
  assert.equal(grid.children.length, 1);
  assert.equal(grid.attributes["aria-busy"], "false");
  assert.equal(elements["linkedin-status"].hidden, true);
  assert.equal(errors.length, 0);
  assert.ok(allNodes(grid).some(node => node.textContent === malicious));
  const links = allNodes(grid).filter(node => node.tag === "a");
  assert.equal(links.length, 3);
  for (const link of links) {
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
  }
  assert.equal(requests[0][0], "assets/data/linkedin.json");
  assert.equal(requests[0][1].cache, "no-cache");
});

test("honestly displays an empty successful feed", async () => {
  const { elements, errors } = await render(feed());
  assert.match(elements["linkedin-status"].textContent, /No public LinkedIn posts/);
  assert.equal(elements["linkedin-grid"].children.length, 0);
  assert.equal(errors.length, 0);
});

test("missing feed explains setup rather than showing demo posts", async () => {
  const { elements } = await render(null, 404);
  assert.match(elements["linkedin-status"].textContent, /not connected yet/);
  assert.equal(elements["linkedin-grid"].attributes["aria-busy"], "false");
});

test("network failures and malformed feeds are visible", async () => {
  for (const [data, status, network] of [[null, 500, false], [null, 200, true],
    [{ items: [] }, 200, false], [feed([item({ publishedAt: "bad" })]), 200, false]]) {
    const { elements, errors } = await render(data, status, network);
    assert.match(elements["linkedin-status"].textContent, /temporarily unavailable/);
    assert.equal(elements["linkedin-grid"].children.length, 0);
    assert.equal(errors.length, 1);
  }
});

test("unsafe links reject the entire feed without partial rendering", async () => {
  for (const fields of [
    { url: "javascript:alert(1)" }, { url: "https://attacker.test/" },
    { url: "https://www.linkedin.com/feed/update/urn:li:share:123/?token=secret" },
    { articleUrl: "javascript:alert(1)" }, { articleUrl: "https://user:pass@example.org" }
  ]) {
    const { elements } = await render(feed([item(), item(fields)]));
    assert.equal(elements["linkedin-grid"].children.length, 0);
    assert.match(elements["linkedin-status"].textContent, /temporarily unavailable/);
  }
});

test("older feeds show an explicit delayed-sync notice", async () => {
  const data = feed([item()]);
  data.updatedAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { elements } = await render(data);
  assert.match(elements["linkedin-updated"].textContent, /updates are delayed/);
  assert.equal(elements["linkedin-grid"].children.length, 1);
});
