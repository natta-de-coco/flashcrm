// Text for the "integrationLogs" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "integrationLogs.integrationLogs": "Integration logs",
    "integrationLogs.connectionActivity": "Connection activity",
    "integrationLogs.whoConnectedScannedOrDisconnected":
      "Who connected, scanned or disconnected what — kept for compliance.",
    "integrationLogs.noIntegrationActivityYetConnect":
      "No integration activity yet. Connect a platform above and it shows up here.",
    "integrationLogs.system": "System",
    "integrationLogs.incomingWebhooks": "Incoming webhooks",
    "integrationLogs.whatsappPluginAndPlatformCallbacks":
      "WhatsApp, plugin and platform callbacks with delivery status.",
    "integrationLogs.noWebhookTrafficRecordedYet": "No webhook traffic recorded yet.",
    "integrationLogs.action.connection.authorize_started": "Authorization started",
    "integrationLogs.action.connection.authorize_succeeded": "Authorization succeeded",
    "integrationLogs.action.connection.authorize_failed": "Authorization failed",
    "integrationLogs.action.connection.authorize_expired": "Authorization link expired",
    "integrationLogs.action.connection.authorize_cancelled": "Authorization cancelled",
    "integrationLogs.action.connection.authorize_blocked": "Could not start authorization",
    "integrationLogs.action.connection.platform_app_saved": "Platform app keys saved",
    "integrationLogs.action.connection.connected": "Platform connected",
    "integrationLogs.action.connection.disconnected": "Platform disconnected",
    "integrationLogs.action.connection.scanned": "Flas profile scan",
    "integrationLogs.action.site.activated": "Website plugin activated",
    "integrationLogs.action.website.synced": "Website knowledge synced",
  },
  ar: {
    "integrationLogs.integrationLogs": "سجلات التكاملات",
    "integrationLogs.connectionActivity": "نشاط الاتصالات",
    "integrationLogs.whoConnectedScannedOrDisconnected":
      "من ربط أو فحص أو قطع ماذا — يُحفظ لأغراض الامتثال.",
    "integrationLogs.noIntegrationActivityYetConnect":
      "لا يوجد نشاط للتكاملات بعد. اربط منصة أعلاه وستظهر هنا.",
    "integrationLogs.system": "النظام",
    "integrationLogs.incomingWebhooks": "Webhooks الواردة",
    "integrationLogs.whatsappPluginAndPlatformCallbacks":
      "ردود واتساب والإضافة والمنصات مع حالة التسليم.",
    "integrationLogs.noWebhookTrafficRecordedYet": "لم تُسجَّل حركة Webhook بعد.",
    "integrationLogs.action.connection.authorize_started": "بدأ التفويض",
    "integrationLogs.action.connection.authorize_succeeded": "نجح التفويض",
    "integrationLogs.action.connection.authorize_failed": "فشل التفويض",
    "integrationLogs.action.connection.authorize_expired": "انتهت صلاحية رابط التفويض",
    "integrationLogs.action.connection.authorize_cancelled": "أُلغي التفويض",
    "integrationLogs.action.connection.authorize_blocked": "تعذّر بدء التفويض",
    "integrationLogs.action.connection.platform_app_saved": "حُفظت مفاتيح تطبيق المنصة",
    "integrationLogs.action.connection.connected": "رُبطت المنصة",
    "integrationLogs.action.connection.disconnected": "قُطع اتصال المنصة",
    "integrationLogs.action.connection.scanned": "فحص Flas للملف الشخصي",
    "integrationLogs.action.site.activated": "فُعّلت إضافة الموقع",
    "integrationLogs.action.website.synced": "تمت مزامنة معلومات الموقع",
  },
  ms: {
    "integrationLogs.integrationLogs": "Log integrasi",
    "integrationLogs.connectionActivity": "Aktiviti sambungan",
    "integrationLogs.whoConnectedScannedOrDisconnected":
      "Siapa menyambung, mengimbas atau memutuskan apa — disimpan untuk pematuhan.",
    "integrationLogs.noIntegrationActivityYetConnect":
      "Belum ada aktiviti integrasi. Sambungkan platform di atas dan ia akan muncul di sini.",
    "integrationLogs.system": "Sistem",
    "integrationLogs.incomingWebhooks": "Webhook masuk",
    "integrationLogs.whatsappPluginAndPlatformCallbacks":
      "Panggil balik WhatsApp, pemalam dan platform dengan status penghantaran.",
    "integrationLogs.noWebhookTrafficRecordedYet": "Belum ada trafik webhook direkodkan.",
    "integrationLogs.action.connection.authorize_started": "Kebenaran dimulakan",
    "integrationLogs.action.connection.authorize_succeeded": "Kebenaran berjaya",
    "integrationLogs.action.connection.authorize_failed": "Kebenaran gagal",
    "integrationLogs.action.connection.authorize_expired": "Pautan kebenaran tamat tempoh",
    "integrationLogs.action.connection.authorize_cancelled": "Kebenaran dibatalkan",
    "integrationLogs.action.connection.authorize_blocked": "Tidak dapat memulakan kebenaran",
    "integrationLogs.action.connection.platform_app_saved": "Kunci aplikasi platform disimpan",
    "integrationLogs.action.connection.connected": "Platform disambungkan",
    "integrationLogs.action.connection.disconnected": "Platform diputuskan",
    "integrationLogs.action.connection.scanned": "Imbasan profil Flas",
    "integrationLogs.action.site.activated": "Pemalam laman web diaktifkan",
    "integrationLogs.action.website.synced": "Pengetahuan laman web disegerakkan",
  },
  fil: {
    "integrationLogs.integrationLogs": "Mga log ng integrasyon",
    "integrationLogs.connectionActivity": "Aktibidad ng koneksyon",
    "integrationLogs.whoConnectedScannedOrDisconnected":
      "Sino ang nagkonekta, nag-scan o nag-disconnect ng ano — itinatago para sa compliance.",
    "integrationLogs.noIntegrationActivityYetConnect":
      "Wala pang aktibidad ng integrasyon. Magkonekta ng platform sa itaas at lalabas ito rito.",
    "integrationLogs.system": "System",
    "integrationLogs.incomingWebhooks": "Mga papasok na webhook",
    "integrationLogs.whatsappPluginAndPlatformCallbacks":
      "Mga callback ng WhatsApp, plugin at platform na may status ng paghatid.",
    "integrationLogs.noWebhookTrafficRecordedYet": "Wala pang naitalang webhook traffic.",
    "integrationLogs.action.connection.authorize_started": "Sinimulan ang authorization",
    "integrationLogs.action.connection.authorize_succeeded": "Nagtagumpay ang authorization",
    "integrationLogs.action.connection.authorize_failed": "Nabigo ang authorization",
    "integrationLogs.action.connection.authorize_expired": "Nag-expire ang authorization link",
    "integrationLogs.action.connection.authorize_cancelled": "Kinansela ang authorization",
    "integrationLogs.action.connection.authorize_blocked": "Hindi masimulan ang authorization",
    "integrationLogs.action.connection.platform_app_saved": "Na-save ang app keys ng platform",
    "integrationLogs.action.connection.connected": "Nakakonekta ang platform",
    "integrationLogs.action.connection.disconnected": "Na-disconnect ang platform",
    "integrationLogs.action.connection.scanned": "Flas profile scan",
    "integrationLogs.action.site.activated": "Na-activate ang website plugin",
    "integrationLogs.action.website.synced": "Na-sync ang kaalaman mula sa website",
  },
  sw: {
    "integrationLogs.integrationLogs": "Kumbukumbu za miunganisho",
    "integrationLogs.connectionActivity": "Shughuli za miunganisho",
    "integrationLogs.whoConnectedScannedOrDisconnected":
      "Nani aliunganisha, alikagua au alitenganisha nini — huhifadhiwa kwa ajili ya uzingatiaji.",
    "integrationLogs.noIntegrationActivityYetConnect":
      "Bado hakuna shughuli za miunganisho. Unganisha jukwaa hapo juu na litaonekana hapa.",
    "integrationLogs.system": "Mfumo",
    "integrationLogs.incomingWebhooks": "Webhook zinazoingia",
    "integrationLogs.whatsappPluginAndPlatformCallbacks":
      "Majibu ya WhatsApp, programu-jalizi na majukwaa pamoja na hali ya uwasilishaji.",
    "integrationLogs.noWebhookTrafficRecordedYet": "Bado hakuna mtiririko wa webhook uliorekodiwa.",
    "integrationLogs.action.connection.authorize_started": "Uidhinishaji umeanza",
    "integrationLogs.action.connection.authorize_succeeded": "Uidhinishaji umefanikiwa",
    "integrationLogs.action.connection.authorize_failed": "Uidhinishaji umeshindwa",
    "integrationLogs.action.connection.authorize_expired": "Kiungo cha uidhinishaji kimeisha muda",
    "integrationLogs.action.connection.authorize_cancelled": "Uidhinishaji umeghairiwa",
    "integrationLogs.action.connection.authorize_blocked": "Imeshindwa kuanza uidhinishaji",
    "integrationLogs.action.connection.platform_app_saved":
      "Funguo za programu ya jukwaa zimehifadhiwa",
    "integrationLogs.action.connection.connected": "Jukwaa limeunganishwa",
    "integrationLogs.action.connection.disconnected": "Jukwaa limetenganishwa",
    "integrationLogs.action.connection.scanned": "Ukaguzi wa wasifu wa Flas",
    "integrationLogs.action.site.activated": "Programu-jalizi ya tovuti imewashwa",
    "integrationLogs.action.website.synced": "Maarifa ya tovuti yamesawazishwa",
  },
});
