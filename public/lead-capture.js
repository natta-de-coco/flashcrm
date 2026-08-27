/**
 * Flas CRM lead capture plugin.
 * Works on WordPress, Shopify or any website:
 *   <script src="https://YOUR-APP/lead-capture.js" data-site-key="YOUR_KEY" async></script>
 * Renders a signup form into any <div data-flas-leads></div>, and also captures
 * submissions from existing forms marked with class="flas-lead-form".
 */
(function () {
  var script = document.currentScript;
  var base = script ? new URL(script.src).origin : window.location.origin;
  var siteKey = script ? script.getAttribute("data-site-key") : null;
  var endpoint = base + "/api/public/leads/collect";
  if (!siteKey) return;

  var css = document.createElement("style");
  css.textContent = [
    ".flasl{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
    ".flasl input{flex:1;min-width:200px;border:1px solid #d6d6d6;border-radius:8px;padding:10px 12px;font-size:14px}",
    ".flasl button{border:0;background:#25D366;color:#fff;border-radius:8px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer}",
    ".flasl-note{width:100%;font-size:12px;color:#4b5563;margin:0}",
    ".flasl-consent{width:100%;display:flex;gap:8px;align-items:flex-start;font-size:11px;color:#4b5563;line-height:1.45}",
    ".flasl-consent input{margin-top:2px;min-width:0;flex:none}",
  ].join("");
  document.head.appendChild(css);

  function submit(payload) {
    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteKey: siteKey,
        email: payload.email,
        name: payload.name || undefined,
        phone: payload.phone || undefined,
        sourceUrl: window.location.href,
        consent: payload.consent === true,
        tags: payload.tags || [],
      }),
    }).then(function (res) {
      if (!res.ok) throw new Error("failed");
      return res.json();
    });
  }

  function mount(container) {
    var heading = container.getAttribute("data-heading") || "Get our latest offers by email";
    var cta = container.getAttribute("data-cta") || "Subscribe";
    var form = document.createElement("form");
    form.className = "flasl";
    form.innerHTML =
      '<input type="text" name="name" placeholder="Your name" />' +
      '<input type="email" name="email" placeholder="you@example.com" required />' +
      '<button type="submit">' +
      cta +
      "</button>" +
      '<label class="flasl-consent"><input type="checkbox" name="consent" required /> <span>I agree to receive marketing messages by email and WhatsApp.</span></label>' +
      '<p class="flasl-note">' +
      heading +
      "</p>";
    container.appendChild(form);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var note = form.querySelector(".flasl-note");
      var button = form.querySelector("button");
      if (!form.consent.checked) {
        note.textContent = "Please tick the consent box so we can contact you.";
        return;
      }
      button.disabled = true;
      submit({ email: form.email.value.trim(), name: form.name.value.trim(), consent: true })
        .then(function () {
          form.innerHTML = '<p class="flasl-note">Thanks! You are on the list.</p>';
        })
        .catch(function () {
          button.disabled = false;
          note.textContent = "Sorry, that did not go through. Please try again.";
        });
    });
  }

  function bindExisting() {
    var forms = document.querySelectorAll("form.flas-lead-form");
    Array.prototype.forEach.call(forms, function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var emailField = form.querySelector('[type="email"], [name="email"]');
        var nameField = form.querySelector('[name="name"]');
        var phoneField = form.querySelector('[name="phone"], [type="tel"]');
        var consentField = form.querySelector('[name="consent"]');
        if (!emailField || !emailField.value) return;
        submit({
          email: emailField.value.trim(),
          name: nameField ? nameField.value.trim() : "",
          phone: phoneField ? phoneField.value.trim() : "",
          consent: consentField ? consentField.checked : false,
        })
          .then(function () {
            form.setAttribute("data-flas-sent", "true");
            form.dispatchEvent(new CustomEvent("flas:lead-captured"));
          })
          .catch(function () {});
      });
    });
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-flas-leads]"), mount);
    bindExisting();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
