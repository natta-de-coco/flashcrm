(function () {
  // Flas website chat widget.
  //
  // Embed:
  //   <script src="https://your-flas-domain/widget.js" data-site-key="..." async></script>
  //
  // The site key is required. The chat endpoint was hardened to demand one
  // (an anonymous, tenant-less session was a cross-tenant hijack path and an
  // unauthenticated AI-cost DoS), and this script was never updated to send
  // it -- so every message was rejected with "Invalid payload". It fails
  // loudly now rather than rendering a launcher that silently cannot work.
  //
  // Before the first message the visitor gives a name and a WhatsApp number,
  // which is what the product has always claimed and is the whole point of the
  // widget: a lead you can answer even if the conversation stops there.
  // Marketing consent is a separate, optional, unticked box -- asking a
  // question is not agreeing to receive campaigns, and conflating the two is
  // what earns blocks and complaints.
  var current = document.currentScript;
  if (!current) return;

  var siteKey = current.getAttribute("data-site-key");
  if (!siteKey) {
    console.error(
      "[Flas] widget.js needs a site key. Use:\n" +
        '  <script src="' +
        current.src +
        '" data-site-key="YOUR_SITE_KEY" async><\/script>\n' +
        "Create one in Flas under Integrations -> Add your website.",
    );
    return;
  }

  var base = new URL(current.src).origin;
  var endpoint = base + "/api/public/widget/chat";
  var privacyUrl = current.getAttribute("data-privacy-url") || base + "/privacy";
  var storeKey = "flas_widget_session";
  var idKey = "flas_widget_identity";

  // The endpoint requires 32+ characters, so build one that always clears it
  // rather than one that happens to most of the time.
  var sessionId = localStorage.getItem(storeKey);
  if (!sessionId || sessionId.length < 32) {
    var rand = function () {
      return Math.random().toString(36).slice(2);
    };
    sessionId = ("web-" + rand() + rand() + rand() + Date.now().toString(36)).slice(0, 64);
    if (sessionId.length < 32) sessionId = (sessionId + rand() + rand()).slice(0, 64);
    try {
      localStorage.setItem(storeKey, sessionId);
    } catch (e) {
      /* private mode: the session simply does not persist */
    }
  }

  // A returning visitor should not be asked for their number again.
  var identity = null;
  try {
    identity = JSON.parse(localStorage.getItem(idKey) || "null");
  } catch (e) {
    identity = null;
  }

  var css = document.createElement("style");
  css.textContent = [
    ".flasw{position:fixed;right:max(20px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:12px;pointer-events:none;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}",
    ".flasw-btn{pointer-events:auto;flex:0 0 auto;width:56px;height:56px;border-radius:999px;border:0;background:#25D366;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.2);cursor:pointer;font-size:24px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0}",
    ".flasw-panel{pointer-events:auto;display:none;flex-direction:column;width:340px;max-width:calc(100vw - 40px);height:460px;max-height:calc(100dvh - 120px);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.25)}",
    ".flasw-panel.open{display:flex}",
    ".flasw-head{background:#075E54;color:#fff;padding:14px 16px;font-weight:600;font-size:14px;flex:0 0 auto}",
    ".flasw-body{flex:1;min-height:0;overflow-y:auto;padding:14px;background:#ECE5DD;display:flex;flex-direction:column;gap:8px}",
    ".flasw-msg{max-width:80%;padding:8px 12px;border-radius:14px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word}",
    ".flasw-me{align-self:flex-end;background:#DCF8C6;color:#111}",
    ".flasw-them{align-self:flex-start;background:#fff;color:#111}",
    ".flasw-foot{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff;flex:0 0 auto}",
    ".flasw-input{flex:1;min-width:0;border:1px solid #ddd;border-radius:999px;padding:9px 14px;font-size:13px;outline:none}",
    ".flasw-send{border:0;background:#25D366;color:#fff;border-radius:999px;padding:0 16px;font-size:13px;cursor:pointer;flex:0 0 auto}",
    ".flasw-send:disabled{opacity:.5;cursor:default}",
    // Identity form
    ".flasw-gate{flex:1;min-height:0;overflow-y:auto;padding:16px;background:#fff;display:flex;flex-direction:column;gap:10px}",
    ".flasw-gate p{margin:0;font-size:13px;line-height:1.45;color:#333}",
    ".flasw-gate label{display:block;font-size:12px;font-weight:600;color:#444;margin-bottom:4px}",
    ".flasw-gate input[type=text],.flasw-gate input[type=tel],.flasw-gate input[type=email]{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:8px;padding:9px 11px;font-size:13px;outline:none}",
    ".flasw-gate input:focus{border-color:#25D366}",
    ".flasw-consent{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.45;color:#555}",
    ".flasw-consent input{margin:2px 0 0 0;flex:0 0 auto}",
    ".flasw-note{font-size:11px;line-height:1.45;color:#777}",
    ".flasw-note a{color:#075E54}",
    ".flasw-err{font-size:12px;color:#c0392b}",
    ".flasw-start{border:0;background:#25D366;color:#fff;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;margin-top:2px}",
    "@media (max-width:480px){.flasw{right:12px;bottom:12px;left:12px;align-items:flex-end}.flasw-panel{width:100%;max-width:100%;height:min(70vh,460px)}}",
  ].join("");
  document.head.appendChild(css);

  var root = document.createElement("div");
  root.className = "flasw";
  root.innerHTML =
    '<div class="flasw-panel"><div class="flasw-head">Chat with us</div>' +
    '<form class="flasw-gate">' +
    "<p>Leave your details and we'll reply on WhatsApp — even if you close this window.</p>" +
    '<div><label for="flasw-name">Your name</label>' +
    '<input id="flasw-name" type="text" autocomplete="name" required maxlength="80" /></div>' +
    '<div><label for="flasw-phone">WhatsApp number</label>' +
    '<input id="flasw-phone" type="tel" autocomplete="tel" required maxlength="32" placeholder="+971 50 000 0000" /></div>' +
    '<div><label for="flasw-email">Email <span style="font-weight:400;color:#888">(optional)</span></label>' +
    '<input id="flasw-email" type="email" autocomplete="email" maxlength="320" /></div>' +
    '<label class="flasw-consent"><input id="flasw-consent" type="checkbox" />' +
    "<span>Send me offers and updates on WhatsApp. You can reply STOP at any time.</span></label>" +
    '<p class="flasw-note">We use your details only to answer this enquiry. ' +
    '<a href="' +
    privacyUrl +
    '" target="_blank" rel="noreferrer">Privacy notice</a>.</p>' +
    '<p class="flasw-err" hidden></p>' +
    '<button class="flasw-start" type="submit">Start chat</button>' +
    "</form>" +
    '<div class="flasw-body" hidden></div>' +
    '<form class="flasw-foot" hidden><input class="flasw-input" placeholder="Type a message" />' +
    '<button class="flasw-send" type="submit">Send</button></form></div>' +
    '<button class="flasw-btn" aria-label="Open chat">&#128172;</button>';
  document.body.appendChild(root);

  var panel = root.querySelector(".flasw-panel");
  var gate = root.querySelector(".flasw-gate");
  var body = root.querySelector(".flasw-body");
  var form = root.querySelector(".flasw-foot");
  var input = root.querySelector(".flasw-input");
  var sendBtn = root.querySelector(".flasw-send");
  var err = root.querySelector(".flasw-err");

  function showChat() {
    gate.hidden = true;
    body.hidden = false;
    form.hidden = false;
    if (!body.childElementCount) {
      add("Hi! How can we help you today?", false);
    }
    input.focus();
  }

  function add(text, mine) {
    var el = document.createElement("div");
    el.className = "flasw-msg " + (mine ? "flasw-me" : "flasw-them");
    el.textContent = text;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  if (identity && identity.phone) {
    gate.hidden = true;
    body.hidden = false;
    form.hidden = false;
  }

  gate.addEventListener("submit", function (event) {
    event.preventDefault();
    var name = root.querySelector("#flasw-name").value.trim();
    var phone = root.querySelector("#flasw-phone").value.trim();
    var email = root.querySelector("#flasw-email").value.trim();
    var consent = root.querySelector("#flasw-consent").checked;

    // Server-side validation still applies; this is just so the visitor is
    // told what is wrong before a round trip.
    if (name.length < 2) return fail("Please enter your name.");
    if (phone.replace(/[^0-9]/g, "").length < 6) return fail("Please enter a valid number.");
    if (email && email.indexOf("@") < 1) return fail("That email does not look right.");

    err.hidden = true;
    identity = { name: name, phone: phone, email: email || null, consent: consent };
    try {
      localStorage.setItem(idKey, JSON.stringify(identity));
    } catch (e) {
      /* not persisting is fine; the details still send with this message */
    }
    showChat();
  });

  function fail(message) {
    err.textContent = message;
    err.hidden = false;
  }

  var launcher = root.querySelector(".flasw-btn");
  launcher.addEventListener("click", function () {
    var open = panel.classList.toggle("open");
    launcher.innerHTML = open ? "&#10005;" : "&#128172;";
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) return;
    if (identity && identity.phone) showChat();
    else root.querySelector("#flasw-name").focus();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    add(text, true);
    var pending = add("…", false);
    sendBtn.disabled = true;

    var payload = {
      sessionId: sessionId,
      siteKey: siteKey,
      message: text,
    };
    if (identity) {
      if (identity.name) payload.name = identity.name;
      if (identity.phone) payload.phone = identity.phone;
      if (identity.email) payload.email = identity.email;
      if (identity.consent) payload.marketingConsent = true;
    }

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          // Say that it failed. The previous version printed a cheerful
          // "a team member will reply shortly" over a rejected request, so a
          // visitor believed a message had been sent when none had.
          pending.textContent =
            "Sorry — we couldn't deliver that message. Please try again in a moment.";
          console.error("[Flas] widget rejected:", result.data && result.data.error);
          return;
        }
        pending.textContent = result.data.reply || "Thanks! A team member will reply shortly.";
      })
      .catch(function () {
        pending.textContent = "We couldn't send that. Please check your connection and try again.";
      })
      .then(function () {
        sendBtn.disabled = false;
      });
  });
})();
