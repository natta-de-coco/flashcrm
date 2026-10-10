/**
 * src/lib/email-templates.ts
 *
 * Professional, cross-client responsive HTML email templates based on Cerberus
 * and open-source bulletproof email patterns. Compatible with Outlook MSO, Apple Mail,
 * Gmail, iOS Mail, and Android.
 */

import type { EmailTemplate } from "@/types/tenant-email";

export const BUILT_IN_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "welcome_discount",
    name: "Welcome & Exclusive Discount Voucher",
    category: "welcome",
    description: "Personalized welcome email with a stylized discount coupon box and hero image.",
    subject: "Welcome to {{company}}! Here is your exclusive {{discount_code}} voucher",
    previewText: "Claim your special discount inside. Thank you for joining {{company}}!",
    defaultImageUrl: "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1200&auto=format&fit=crop&q=80",
    htmlContent: `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>Welcome to {{company}}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    body { margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    table { border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; width: 100%; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; max-width: 100%; }
    a { color: #16a34a; text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; padding: 12px !important; }
      .hero-img { height: auto !important; max-height: 240px !important; }
      .coupon-box { padding: 18px !important; }
      .btn { width: 100% !important; display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f4f6f8;">
  <center>
    <!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"><tr><td><![endif]-->
    <table role="presentation" class="container" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
      
      <!-- HERO BANNER IMAGE -->
      <tr>
        <td style="padding: 0; background-color: #0f172a; text-align: center;">
          <img src="{{image_url}}" alt="{{company}} Banner" class="hero-img" style="width: 100%; max-height: 280px; object-fit: cover; display: block;" onerror="this.style.display='none'">
        </td>
      </tr>

      <!-- CONTENT BODY -->
      <tr>
        <td style="padding: 36px 32px 24px 32px; color: #1e293b; font-size: 16px; line-height: 1.6;">
          <h1 style="margin: 0 0 16px 0; color: #0f172a; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">
            Welcome to {{company}}, {{name}}! 👋
          </h1>
          <p style="margin: 0 0 20px 0; color: #475569; font-size: 16px;">
            We are thrilled to have you with us. As a token of our appreciation, we have prepared an exclusive promotional offer just for you.
          </p>

          <!-- STYLIZED DISCOUNT COUPON CARD -->
          <div class="coupon-box" style="margin: 28px 0; padding: 24px; background: #f0fdf4; border: 2px dashed #16a34a; border-radius: 10px; text-align: center;">
            <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 1px;">
              Your Exclusive Voucher Code
            </p>
            <div style="display: inline-block; padding: 10px 24px; background: #ffffff; border: 1px solid #bbf7d0; border-radius: 8px; font-size: 24px; font-weight: 800; color: #15803d; letter-spacing: 2px; font-family: monospace;">
              {{discount_code}}
            </div>
            <p style="margin: 10px 0 0 0; font-size: 14px; color: #15803d;">
              Apply this code at checkout to claim your discount!
            </p>
          </div>

          <!-- PRIMARY CALL TO ACTION BUTTON -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
            <tr>
              <td align="center">
                <a href="{{company_url}}" class="btn" style="display: inline-block; padding: 14px 32px; background-color: #16a34a; color: #ffffff; font-weight: 600; font-size: 16px; text-decoration: none; border-radius: 8px; box-shadow: 0 2px 6px rgba(22, 163, 74, 0.3);">
                  Visit Store & Claim Offer &rarr;
                </a>
              </td>
            </tr>
          </table>

          <p style="margin: 20px 0 0 0; font-size: 14px; color: #64748b;">
            Have questions or need assistance? Reply directly to this email or chat with our support team on WhatsApp.
          </p>
        </td>
      </tr>

      <!-- FOOTER & MANDATORY ONE-CLICK UNSUBSCRIBE -->
      <tr>
        <td style="padding: 24px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
          <p style="margin: 0 0 8px 0;">
            &copy; {{current_year}} {{company}}. All rights reserved.
          </p>
          <p style="margin: 0;">
            You received this email because you subscribed on our website.
            <br>
            <a href="{{unsubscribe_url}}" style="color: #64748b; text-decoration: underline;">
              Unsubscribe from marketing emails
            </a>
          </p>
        </td>
      </tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </center>
</body>
</html>`
  },
  {
    id: "product_showcase",
    name: "Product Announcement & Feature Launch",
    category: "announcement",
    description: "Modern promotional layout with hero image slot, benefit bullets, and call to action.",
    subject: "Introducing something new from {{company}} 🚀",
    previewText: "See what we just launched! Read full details inside.",
    defaultImageUrl: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&auto=format&fit=crop&q=80",
    htmlContent: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New from {{company}}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    img { max-width: 100%; border: 0; display: block; }
  </style>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f8fafc;">
  <center>
    <table role="presentation" style="max-width: 600px; width: 100%; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
      <tr>
        <td style="padding: 0;">
          <img src="{{image_url}}" alt="New Feature" style="width: 100%; max-height: 280px; object-fit: cover;">
        </td>
      </tr>
      <tr>
        <td style="padding: 36px 32px; color: #1e293b;">
          <span style="display: inline-block; padding: 4px 12px; background: #e0f2fe; color: #0369a1; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase;">New Release</span>
          <h1 style="margin: 14px 0 16px 0; font-size: 26px; color: #0f172a;">Exciting news, {{name}}!</h1>
          <p style="font-size: 16px; color: #475569; line-height: 1.6;">
            We have been working hard to bring you the best experience possible. Discover our latest updates and features built to help your business grow.
          </p>
          <div style="margin: 24px 0; padding: 18px; background: #f1f5f9; border-radius: 8px;">
            <p style="margin: 0 0 10px 0; font-weight: 700; color: #0f172a;">✨ What is inside:</p>
            <ul style="margin: 0; padding-left: 20px; color: #334155; line-height: 1.6;">
              <li>Enhanced speed & real-time notifications</li>
              <li>New smart integrations and reporting tools</li>
              <li>Exclusive introductory perks for existing members</li>
            </ul>
          </div>
          <a href="{{company_url}}" style="display: inline-block; padding: 14px 30px; background: #0f172a; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">
            Explore Now &rarr;
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8;">
          &copy; {{current_year}} {{company}} | <a href="{{unsubscribe_url}}" style="color: #64748b;">Unsubscribe</a>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`
  },
  {
    id: "flash_sale",
    name: "Flash Sale & Limited Time Offer",
    category: "promotion",
    description: "High-urgency promotional template for seasonal sales, discounts, and flash promotions.",
    subject: "⚡ Flash Sale: Save big today at {{company}}",
    previewText: "Don't miss out! Limited time promotional discount expires soon.",
    defaultImageUrl: "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&auto=format&fit=crop&q=80",
    htmlContent: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flash Sale</title>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
  <center>
    <table role="presentation" style="max-width: 600px; width: 100%; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
      <tr>
        <td style="padding: 0;">
          <img src="{{image_url}}" alt="Flash Sale" style="width: 100%; max-height: 260px; object-fit: cover;">
        </td>
      </tr>
      <tr>
        <td style="padding: 32px; text-align: center;">
          <span style="display: inline-block; padding: 6px 14px; background: #fef2f2; color: #dc2626; border-radius: 9999px; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">
            ⚡ Limited Time Flash Offer
          </span>
          <h1 style="margin: 16px 0 10px 0; font-size: 30px; color: #0f172a; font-weight: 800;">
            Special Savings for {{name}}
          </h1>
          <p style="color: #475569; font-size: 16px; margin: 0 0 24px 0;">
            Take advantage of our exclusive seasonal pricing. Use code below at checkout:
          </p>
          <div style="display: inline-block; padding: 14px 28px; background: #fff1f2; border: 2px dashed #e11d48; border-radius: 8px; font-size: 26px; font-weight: 800; color: #be123c; font-family: monospace;">
            {{discount_code}}
          </div>
          <div style="margin: 28px 0;">
            <a href="{{company_url}}" style="display: inline-block; padding: 14px 36px; background: #e11d48; color: #ffffff; font-weight: 700; text-decoration: none; border-radius: 8px; font-size: 16px;">
              Shop Now & Save &rarr;
            </a>
          </div>
          <p style="font-size: 13px; color: #94a3b8; margin: 0;">* Offer valid for a limited time. Cannot be combined with other offers.</p>
        </td>
      </tr>
      <tr>
        <td style="padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8;">
          &copy; {{current_year}} {{company}} | <a href="{{unsubscribe_url}}" style="color: #64748b;">Unsubscribe</a>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`
  },
  {
    id: "newsletter_digest",
    name: "Newsletter & Company Digest",
    category: "newsletter",
    description: "Clean editorial layout for monthly updates, tips, articles, and community digests.",
    subject: "{{company}} Monthly Digest: Tips, stories & updates",
    previewText: "Your monthly digest is here. Check out what happened this month.",
    defaultImageUrl: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=1200&auto=format&fit=crop&q=80",
    htmlContent: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Newsletter</title>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
  <center>
    <table role="presentation" style="max-width: 600px; width: 100%; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
      <tr>
        <td style="padding: 0;">
          <img src="{{image_url}}" alt="Newsletter Header" style="width: 100%; max-height: 240px; object-fit: cover;">
        </td>
      </tr>
      <tr>
        <td style="padding: 32px; color: #1e293b;">
          <h1 style="margin: 0 0 12px 0; font-size: 24px; color: #0f172a;">The {{company}} Monthly Digest</h1>
          <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
            Hi {{name}}, here is your curated summary of key insights, best practices, and product tips from our team.
          </p>
          <div style="border-left: 4px solid #16a34a; padding-left: 16px; margin: 24px 0;">
            <h3 style="margin: 0 0 6px 0; font-size: 17px; color: #0f172a;">Pro Tip of the Month</h3>
            <p style="margin: 0; font-size: 14px; color: #475569; line-height: 1.5;">
              Automating your initial response on WhatsApp and Email boosts lead conversion by over 40%. Connect your inbox to Flas CRM today.
            </p>
          </div>
          <a href="{{company_url}}" style="display: inline-block; padding: 12px 24px; background: #16a34a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
            Read Full Digest Online &rarr;
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8;">
          &copy; {{current_year}} {{company}} | <a href="{{unsubscribe_url}}" style="color: #64748b;">Unsubscribe</a>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`
  }
];

/**
 * Replace merge tags in template with values, safely falling back to defaults.
 */
export function substituteMergeTags(content: string, variables: Record<string, string>): string {
  let result = content;
  const currentYear = new Date().getFullYear().toString();
  const merged: Record<string, string> = {
    current_year: currentYear,
    name: "Customer",
    company: "Flas CRM",
    discount_code: "WELCOME20",
    unsubscribe_url: "/unsubscribe",
    company_url: "https://flas.mobidigisol.com",
    image_url: "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1200&auto=format&fit=crop&q=80",
    ...variables,
  };

  for (const [key, val] of Object.entries(merged)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    result = result.replace(regex, val);
  }

  return result;
}

/**
 * Validates email marketing HTML content for security, deliverability, and compliance.
 */
export function validateEmailMarketingHtml(html: string): {
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Mandatory Unsubscribe Check (CAN-SPAM / GDPR / RFC 8058)
  if (!html.includes("{{unsubscribe_url}}") && !/unsubscribe/i.test(html)) {
    errors.push("Missing mandatory unsubscribe link (required by CAN-SPAM and GDPR). Include {{unsubscribe_url}}.");
  }

  // 2. Unsafe Script Tags
  if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(html)) {
    errors.push("Unsafe <script> tag detected. Email clients strictly prohibit JavaScript execution.");
  }

  // 3. Excessively Large Inline Data URIs (Gmail clipping warning > 100KB)
  const dataUriMatch = html.match(/src=["']data:image\/[^;]+;base64,[^"']+["']/gi);
  if (dataUriMatch && dataUriMatch.length > 0) {
    warnings.push("Inline base64 image detected. Some email clients (e.g. Gmail) block inline data URIs or clip large messages. Prefer hosted image URLs.");
  }

  // 4. Missing Alt Text on Images
  const imgWithoutAlt = /<img(?![^>]*\balt=)[^>]*>/gi;
  if (imgWithoutAlt.test(html)) {
    warnings.push("One or more images are missing alt text. Adding descriptive alt attributes improves accessibility and spam scores.");
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
