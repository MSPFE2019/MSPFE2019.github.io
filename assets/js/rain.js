(function () {
  "use strict";

  var canvas = document.getElementById("code-rain");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;
  var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var streams = [];
  var width = 0;
  var height = 0;
  var frameId = null;
  var lastTime = 0;
  var glyphs = "01{}[]<>/\\:+*=POWERAPPSDATAVERSE";
  var ink = "";
  var headInk = "";

  function colors() {
    var styles = getComputedStyle(document.documentElement);
    ink = styles.getPropertyValue("--cp-success").trim();
    headInk = styles.getPropertyValue("--cp-text").trim();
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    streams = Array.from({ length: Math.ceil(width / 28) }, function (_, index) {
      return {
        x: index * 28,
        y: Math.random() * (height + 400) - 200,
        speed: 35 + Math.random() * 45,
        length: 8 + Math.floor(Math.random() * 12),
        seed: index * 7
      };
    });
    colors();
    paint(0);
  }

  function paint(delta) {
    ctx.clearRect(0, 0, width, height);
    ctx.font = "14px Consolas, monospace";
    streams.forEach(function (stream) {
      stream.y += stream.speed * delta;
      if (stream.y - stream.length * 20 > height) stream.y = -20;
      for (var i = 0; i < stream.length; i++) {
        var y = stream.y - i * 20;
        if (y < 0 || y > height) continue;
        ctx.globalAlpha = (1 - i / stream.length) * 0.6;
        ctx.fillStyle = i === 0 ? headInk : ink;
        var glyph = (stream.seed + i + Math.floor(stream.y / 20)) % glyphs.length;
        ctx.fillText(glyphs.charAt(Math.abs(glyph)), stream.x, y);
      }
    });
    ctx.globalAlpha = 1;
  }

  function frame(time) {
    var elapsed = time - lastTime;
    if (elapsed >= 33) {
      paint(Math.min(elapsed / 1000, 0.1));
      lastTime = time;
    }
    frameId = requestAnimationFrame(frame);
  }

  function syncMotion() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    if (!motion.matches && !document.hidden) {
      lastTime = performance.now();
      frameId = requestAnimationFrame(frame);
    } else if (motion.matches) {
      ctx.clearRect(0, 0, width, height);
    }
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", syncMotion);
  motion.addEventListener("change", syncMotion);
  new MutationObserver(colors).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"]
  });
  resize();
  syncMotion();
})();
