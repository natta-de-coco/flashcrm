/**
 * Flas CRM side popup chatbot.
 * Embed anywhere:
 *   <script src="https://YOUR-APP/flas-popup.js" data-site-key="YOUR_KEY" async></script>
 * Slides in from the right, collects WhatsApp number + email, then chats with the AI assistant.
 */
(function () {
  var script = document.currentScript;
  var base = script ? new URL(script.src).origin : window.location.origin;
  var siteKey = script ? script.getAttribute("data-site-key") : null;
  if (!siteKey) return;

  var title = (script && script.getAttribute("data-title")) || "Chat with us";
  var greeting =
    (script && script.getAttribute("data-greeting")) ||
    "Hi! Leave your WhatsApp number and we will reply right away.";
  var accent = (script && script.getAttribute("data-accent")) || "#25D366";
  var brand = (script && script.getAttribute("data-brand")) || "#075E54";

  var chatEndpoint = base + "/api/public/widget/chat";
  var leadEndpoint = base + "/api/public/leads/collect";
  var storeKey = "flas_popup_" + siteKey;

  var state = {};
  try {
    state = JSON.parse(localStorage.getItem(storeKey) || "{}") || {};
  } catch (error) {
    state = {};
  }
  if (!state.sessionId) {
    state.sessionId = "web-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function persist() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
    } catch (error) {
      /* storage blocked */
    }
  }
  persist();

  // One-time activation ping: registers the site's domain with Flas CRM so an
  // admin can activate it (WordPress does this from PHP; Shopify/others do it here).
  if (!state.pinged) {
    state.pinged = true;
    persist();
    try {
      fetch(base + "/api/public/plugin/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteKey: siteKey,
          domain: window.location.origin,
          platform: (script && script.getAttribute("data-platform")) || "website",
        }),
      }).catch(function () {
        state.pinged = false;
      });
    } catch (error) {
      state.pinged = false;
    }
  }

  var css = document.createElement("style");
  css.textContent = [
    ".flasp{position:fixed;right:0;bottom:0;z-index:2147483000;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}",
    ".flasp-launch{position:fixed;right:20px;bottom:20px;display:flex;align-items:center;gap:10px;border:0;border-radius:999px;padding:14px 20px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 12px 30px rgba(0,0,0,.22)}",
    ".flasp-panel{position:fixed;top:0;right:0;height:100%;width:380px;max-width:100vw;background:#fff;display:flex;flex-direction:column;box-shadow:-20px 0 60px rgba(0,0,0,.25);transform:translateX(100%);transition:transform .28s ease}",
    ".flasp-panel.open{transform:translateX(0)}",
    ".flasp-head{color:#fff;padding:18px 20px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
    ".flasp-head h3{margin:0;font-size:16px;font-weight:700}",
    ".flasp-head p{margin:4px 0 0;font-size:12px;opacity:.85;line-height:1.5}",
    ".flasp-x{background:transparent;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;opacity:.8}",
    ".flasp-body{flex:1;overflow-y:auto;padding:16px;background:#F4F6F5;display:flex;flex-direction:column;gap:10px}",
    ".flasp-msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:13px;line-height:1.5;white-space:pre-wrap}",
    ".flasp-me{align-self:flex-end;background:#DCF8C6;color:#111}",
    ".flasp-them{align-self:flex-start;background:#fff;color:#111;box-shadow:0 1px 2px rgba(0,0,0,.06)}",
    ".flasp-form{padding:16px;display:flex;flex-direction:column;gap:10px;border-top:1px solid #eceeed;background:#fff}",
    ".flasp-form label{font-size:12px;font-weight:600;color:#374151}",
    ".flasp-form input{border:1px solid #d8dcda;border-radius:10px;padding:11px 12px;font-size:14px;width:100%;box-sizing:border-box}",
    ".flasp-form button{border:0;color:#fff;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer}",
    ".flasp-note{margin:0;font-size:11px;color:#6b7280;line-height:1.5}",
    ".flasp-consent{display:flex;gap:8px;align-items:flex-start;font-size:11px;color:#4b5563;line-height:1.45}",
    ".flasp-consent input{margin-top:2px}",
    ".flasp-foot{display:none;gap:8px;padding:12px;border-top:1px solid #eceeed;background:#fff}",
    ".flasp-foot.on{display:flex}",
    ".flasp-input{flex:1;border:1px solid #d8dcda;border-radius:999px;padding:10px 14px;font-size:13px;outline:none}",
    ".flasp-send{border:0;color:#fff;border-radius:999px;padding:0 18px;font-size:13px;font-weight:600;cursor:pointer}",
    "@media(max-width:520px){.flasp-panel{width:100vw}}",
  ].join("");
  document.head.appendChild(css);

  var root = document.createElement("div");
  root.className = "flasp";
  root.innerHTML =
    '<button class="flasp-launch" aria-label="Open chat">&#128172; <span>' +
    title +
    "</span></button>" +
    '<aside class="flasp-panel" role="dialog" aria-label="' +
    title +
    '">' +
    '<div class="flasp-head"><div><h3>' +
    title +
    "</h3><p>" +
    greeting +
    '</p></div><button class="flasp-x" aria-label="Close chat">&times;</button></div>' +
    '<div class="flasp-body"></div>' +
    '<form class="flasp-form">' +
    '<div><label for="flasp-name">Your name</label><input id="flasp-name" name="name" type="text" placeholder="Jane Doe" required /></div>' +
    '<div><label for="flasp-phone">WhatsApp number</label><input id="flasp-phone" name="phone" type="tel" placeholder="+971 50 123 4567" required /></div>' +
    '<div><label for="flasp-email">Email</label><input id="flasp-email" name="email" type="email" placeholder="you@company.com" required /></div>' +
    '<label class="flasp-consent"><input type="checkbox" name="consent" required /> <span>I agree to be contacted on WhatsApp and by email about my enquiry and related offers.</span></label>' +
    '<button type="submit">Start the chat</button>' +
    '<p class="flasp-note">We use these details to reply on WhatsApp and email. No spam.</p>' +
    "</form>" +
    '<form class="flasp-foot"><input class="flasp-input" placeholder="Type a message" /><button class="flasp-send" type="submit">Send</button></form>' +
    "</aside>";
  document.body.appendChild(root);

  var launch = root.querySelector(".flasp-launch");
  var panel = root.querySelector(".flasp-panel");
  var head = root.querySelector(".flasp-head");
  var body = root.querySelector(".flasp-body");
  var lead = root.querySelector(".flasp-form");
  var chat = root.querySelector(".flasp-foot");
  var input = root.querySelector(".flasp-input");

  launch.style.background = accent;
  head.style.background = brand;
  lead.querySelector("button").style.background = accent;
  root.querySelector(".flasp-send").style.background = accent;

  function add(text, mine) {
    var el = document.createElement("div");
    el.className = "flasp-msg " + (mine ? "flasp-me" : "flasp-them");
    el.textContent = text;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  function showChat() {
    lead.style.display = "none";
    body.style.display = "flex";
    chat.classList.add("on");
    if (!body.childElementCount) {
      add("Thanks " + (state.name || "") + "! How can we help you today?", false);
    }
  }

  function open() {
    panel.classList.add("open");
    launch.style.display = "none";
    if (state.captured) showChat();
  }
  function close() {
    panel.classList.remove("open");
    launch.style.display = "flex";
  }

  launch.addEventListener("click", open);
  root.querySelector(".flasp-x").addEventListener("click", close);
  if (state.captured) showChat();
  else body.style.display = "none";

  lead.addEventListener("submit", function (event) {
    event.preventDefault();
    var button = lead.querySelector("button");
    var name = lead.querySelector("[name=name]").value.trim();
    var phone = lead.querySelector("[name=phone]").value.trim();
    var email = lead.querySelector("[name=email]").value.trim();
    var consent = lead.querySelector("[name=consent]").checked;
    if (!name || !phone || !email || !consent) return;
    button.disabled = true;
    button.textContent = "Connecting…";

    fetch(leadEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteKey: siteKey,
        email: email,
        name: name,
        phone: phone,
        sourceUrl: window.location.href,
        consent: true,
        tags: ["popup-chat"],
      }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("failed");
        state.captured = true;
        state.name = name;
        persist();
        showChat();
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = "Start the chat";
        add("We couldn't save your details. Please check them and try again.", false);
      });
  });

  chat.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    add(text, true);
    var pending = add("…", false);

    fetch(chatEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteKey: siteKey,
        sessionId: state.sessionId,
        name: state.name || undefined,
        message: text,
      }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        pending.textContent = data.reply || "Thanks! A team member will reply shortly.";
      })
      .catch(function () {
        pending.textContent = "We couldn't send that. Please try again.";
      });
  });
})();
