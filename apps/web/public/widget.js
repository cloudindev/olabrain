/*!
 * OlaBrain web widget. Usage:
 *   <script src="https://app.olabrain.com/widget.js" data-agent="WIDGET_ID" async></script>
 * Adds a floating avatar (with an animated neon halo) that opens the agent's chat and voice
 * in an isolated iframe. No dependencies; styles live in a Shadow DOM.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var id = script.getAttribute("data-agent");
  if (!id || window.__olabrainWidget) return;
  window.__olabrainWidget = true;
  var base = new URL(script.src).origin;

  // Same palettes as apps/web/src/components/widget/halo.ts.
  var PALETTES = {
    neon: ["#ff2bd6", "#7c4dff", "#00e5ff", "#a6f55a", "#ffe600", "#ff2bd6"],
    normal: ["#d6338f", "#5b3cc4", "#1d9bc0", "#5fae2e", "#e0b100", "#d6338f"],
    pastel: ["#f9a8d4", "#c4b5fd", "#a5f3fc", "#d9f99d", "#fde68a", "#f9a8d4"]
  };
  var TONE = {
    neon: { s: 100, l: [60, 65, 50, 62] },
    normal: { s: 65, l: [45, 52, 38, 48] },
    pastel: { s: 70, l: [82, 86, 76, 84] }
  };
  var GLOW = {
    neon: { o: 0.75, b: 14 },
    normal: { o: 0.3, b: 8 },
    pastel: { o: 0.55, b: 12 }
  };
  function styleOf(halo) {
    var st = halo && halo.style;
    return st === "normal" || st === "pastel" ? st : "neon";
  }
  function hue(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 0;
    var h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h * 60;
  }
  function colors(halo) {
    var st = styleOf(halo);
    if (!halo || halo.mode !== "tone") return PALETTES[st];
    var h = hue(halo.color || "#a6f55a"), t = TONE[st];
    function s(dh, l) { return "hsl(" + ((h + dh + 360) % 360) + " " + t.s + "% " + l + "%)"; }
    return [s(0, t.l[0]), s(35, t.l[1]), s(0, t.l[2]), s(-35, t.l[3]), s(0, t.l[0])];
  }

  fetch(base + "/api/widget/" + encodeURIComponent(id) + "/config")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) { if (cfg) mount(cfg); })
    .catch(function () {});

  function mount(cfg) {
    var side = cfg.position === "left" ? "left" : "right";
    var grad = "conic-gradient(" + colors(cfg.halo).join(",") + ")";
    var glow = GLOW[styleOf(cfg.halo)];
    var size = Math.min(96, Math.max(48, Number(cfg.size) || 68));
    var ring = Math.round(size * 0.075);
    var host = document.createElement("div");
    host.setAttribute("data-olabrain", "");
    host.style.cssText = "position:fixed;z-index:2147483000;bottom:0;" + side + ":0;";
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: "open" });
    var initials = (cfg.name || "?").slice(0, 1).toUpperCase();
    root.innerHTML =
      "<style>" +
      ":host{all:initial}" +
      ".btn{position:fixed;bottom:22px;" + side + ":22px;width:" + size + "px;height:" + size + "px;border:0;padding:0;background:none;cursor:pointer;border-radius:50%;}" +
      ".ring,.glow{position:absolute;inset:-" + ring + "px;border-radius:50%;background:" + grad + ";animation:spin 4s linear infinite}" +
      ".glow{inset:-" + ring * 2 + "px;filter:blur(" + glow.b + "px);opacity:" + glow.o + ";animation:spin 4s linear infinite,pulse 2.4s ease-in-out infinite}" +
      ".face{position:absolute;inset:0;border-radius:50%;overflow:hidden;background:#131313;border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#a6f55a;font:700 " + Math.round(size * 0.38) + "px system-ui,sans-serif}" +
      ".face img{width:100%;height:100%;object-fit:cover;object-position:top}" +
      ".btn:hover .face{transform:scale(1.04)}.face{transition:transform .2s}" +
      ".panel{position:fixed;bottom:" + (size + 36) + "px;" + side + ":22px;width:380px;height:min(620px,calc(100vh - 130px));border:0;border-radius:22px;overflow:hidden;box-shadow:0 24px 70px -20px rgba(0,0,0,.45);background:#fff;opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .2s,transform .2s}" +
      ".panel.open{opacity:1;transform:none;pointer-events:auto}" +
      ".panel iframe{width:100%;height:100%;border:0}" +
      "@media (max-width:520px){.panel{inset:0;width:100%;height:100%;border-radius:0}.panel.open~.btn{display:none}}" +
      "@keyframes spin{to{transform:rotate(360deg)}}" +
      "@keyframes pulse{0%,100%{opacity:" + glow.o * 0.7 + "}50%{opacity:" + Math.min(1, glow.o * 1.25) + "}}" +
      "@media (prefers-reduced-motion:reduce){.ring,.glow{animation:none}}" +
      "</style>" +
      '<div class="panel" role="dialog" aria-label="Chat"></div>' +
      '<button class="btn" type="button" aria-label="Chat">' +
      '<span class="glow"></span><span class="ring"></span><span class="face"></span></button>';

    var face = root.querySelector(".face");
    if (cfg.avatar) {
      var img = document.createElement("img");
      img.src = /^https?:/.test(cfg.avatar) ? cfg.avatar : base + cfg.avatar;
      img.alt = "";
      face.appendChild(img);
    } else {
      face.textContent = initials;
    }
    var btn = root.querySelector(".btn");
    btn.setAttribute("aria-label", "Chat con " + (cfg.name || ""));
    var panel = root.querySelector(".panel");
    var frame = null;

    function toggle(open) {
      if (open && !frame) {
        frame = document.createElement("iframe");
        frame.src = base + "/embed/" + encodeURIComponent(id);
        frame.title = cfg.name || "Chat";
        frame.allow = "microphone; autoplay";
        panel.appendChild(frame);
      }
      panel.classList.toggle("open", open);
    }
    btn.addEventListener("click", function () { toggle(!panel.classList.contains("open")); });
    window.addEventListener("message", function (e) {
      if (e.origin === base && e.data && e.data.type === "olabrain:close") toggle(false);
    });
  }
})();
