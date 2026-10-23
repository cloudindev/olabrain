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

  var RAINBOW = ["#ff2bd6", "#7c4dff", "#00e5ff", "#a6f55a", "#ffe600", "#ff2bd6"];
  function hue(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 0;
    var h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h * 60;
  }
  function colors(halo) {
    if (!halo || halo.mode !== "tone") return RAINBOW;
    var h = hue(halo.color || "#a6f55a");
    function s(dh, l) { return "hsl(" + ((h + dh + 360) % 360) + " 100% " + l + "%)"; }
    return [s(0, 60), s(35, 65), s(0, 50), s(-35, 62), s(0, 60)];
  }

  fetch(base + "/api/widget/" + encodeURIComponent(id) + "/config")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) { if (cfg) mount(cfg); })
    .catch(function () {});

  function mount(cfg) {
    var side = cfg.position === "left" ? "left" : "right";
    var grad = "conic-gradient(" + colors(cfg.halo).join(",") + ")";
    var host = document.createElement("div");
    host.setAttribute("data-olabrain", "");
    host.style.cssText = "position:fixed;z-index:2147483000;bottom:0;" + side + ":0;";
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: "open" });
    var initials = (cfg.name || "?").slice(0, 1).toUpperCase();
    root.innerHTML =
      "<style>" +
      ":host{all:initial}" +
      ".btn{position:fixed;bottom:22px;" + side + ":22px;width:68px;height:68px;border:0;padding:0;background:none;cursor:pointer;border-radius:50%;}" +
      ".ring,.glow{position:absolute;inset:-5px;border-radius:50%;background:" + grad + ";animation:spin 4s linear infinite}" +
      ".glow{inset:-10px;filter:blur(14px);opacity:.75;animation:spin 4s linear infinite,pulse 2.4s ease-in-out infinite}" +
      ".face{position:absolute;inset:0;border-radius:50%;overflow:hidden;background:#131313;border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#a6f55a;font:700 26px system-ui,sans-serif}" +
      ".face img{width:100%;height:100%;object-fit:cover;object-position:top}" +
      ".btn:hover .face{transform:scale(1.04)}.face{transition:transform .2s}" +
      ".panel{position:fixed;bottom:104px;" + side + ":22px;width:380px;height:min(620px,calc(100vh - 130px));border:0;border-radius:22px;overflow:hidden;box-shadow:0 24px 70px -20px rgba(0,0,0,.45);background:#fff;opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .2s,transform .2s}" +
      ".panel.open{opacity:1;transform:none;pointer-events:auto}" +
      ".panel iframe{width:100%;height:100%;border:0}" +
      "@media (max-width:520px){.panel{inset:0;width:100%;height:100%;border-radius:0}.panel.open~.btn{display:none}}" +
      "@keyframes spin{to{transform:rotate(360deg)}}" +
      "@keyframes pulse{0%,100%{opacity:.55}50%{opacity:.95}}" +
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
