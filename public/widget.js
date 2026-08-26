(function () {
  var current = document.currentScript;
  var base = current ? new URL(current.src).origin : window.location.origin;
  var endpoint = base + "/api/public/widget/chat";
  var storeKey = "flas_widget_session";
  var sessionId = localStorage.getItem(storeKey);
  if (!sessionId) {
    sessionId = "web-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(storeKey, sessionId);
  }

  var css = document.createElement("style");
  css.textContent = [
    // Column flex + align-items:flex-end keeps the launcher pinned to the
    // bottom-right corner. Without it the button sits at the left edge of the
    // open panel and overlaps the page content.
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
    "@media (max-width:480px){.flasw{right:12px;bottom:12px;left:12px;align-items:flex-end}.flasw-panel{width:100%;max-width:100%;height:min(70vh,460px)}}",
  ].join("");
  document.head.appendChild(css);


  var root = document.createElement("div");
  root.className = "flasw";
  root.innerHTML =
    '<div class="flasw-panel"><div class="flasw-head">Chat with us</div>' +
    '<div class="flasw-body"></div>' +
    '<form class="flasw-foot"><input class="flasw-input" placeholder="Type a message" />' +
    '<button class="flasw-send" type="submit">Send</button></form></div>' +
    '<button class="flasw-btn" aria-label="Open chat">&#128172;</button>';
  document.body.appendChild(root);

  var panel = root.querySelector(".flasw-panel");
  var body = root.querySelector(".flasw-body");
  var form = root.querySelector(".flasw-foot");
  var input = root.querySelector(".flasw-input");

  function add(text, mine) {
    var el = document.createElement("div");
    el.className = "flasw-msg " + (mine ? "flasw-me" : "flasw-them");
    el.textContent = text;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  var launcher = root.querySelector(".flasw-btn");
  launcher.addEventListener("click", function () {
    var open = panel.classList.toggle("open");
    launcher.innerHTML = open ? "&#10005;" : "&#128172;";
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && !body.childElementCount) {
      add("Hi! How can we help you today?", false);
    }
    if (open) input.focus();
  });


  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    add(text, true);
    var pending = add("…", false);

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId, message: text }),
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
