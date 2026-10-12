// Text for the "kpiTargetsCard" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "kpiTargetsCard.advisorSetKpiTargets": "Advisor set {saved} KPI targets",
    "kpiTargetsCard.theAdvisorCouldNotSet":
      "The advisor could not set targets yet — add more data first",
    "kpiTargetsCard.kpiTargetsSaved": "KPI targets saved",
    "kpiTargetsCard.kpiTargetsAlerts": "KPI targets & alerts",
    "kpiTargetsCard.responseTimeConversionLeadVelocity":
      "Response time, conversion, lead velocity and social backlog — measured live against the targets your advisor sets.",
    "kpiTargetsCard.setting": "Setting…",
    "kpiTargetsCard.letAdvisorSetTargets": "Let advisor set targets",
    "kpiTargetsCard.checkNow": "Check now",
    "kpiTargetsCard.resolve": "Resolve",
    "kpiTargetsCard.lowerIsBetter": "lower is better",
    "kpiTargetsCard.higherIsBetter": "higher is better",
    "kpiTargetsCard.advisor": "advisor",
    "kpiTargetsCard.offTarget": "off target",
    "kpiTargetsCard.onTrack": "on track",
    "kpiTargetsCard.notEnoughData": "not enough data",
    "kpiTargetsCard.now": "Now: {span} · {value}",
    "kpiTargetsCard.target": "target",
    "kpiTargetsCard.saveTargets": "Save targets",
    "kpiTargetsCard.metric.response_minutes.label": "First response time",
    "kpiTargetsCard.metric.response_minutes.hint":
      "Average minutes before a human or bot answers a new inbound chat (30 days).",
    "kpiTargetsCard.metric.response_minutes.unit": "min",
    "kpiTargetsCard.metric.read_rate.label": "Read rate",
    "kpiTargetsCard.metric.read_rate.hint":
      "Share of outbound WhatsApp messages that were read (30 days).",
    "kpiTargetsCard.metric.conversion_rate.label": "Lead conversion",
    "kpiTargetsCard.metric.conversion_rate.hint": "Share of contacts that reached the Won stage.",
    "kpiTargetsCard.metric.lead_velocity.label": "Lead velocity",
    "kpiTargetsCard.metric.lead_velocity.hint": "New leads captured in the last 7 days.",
    "kpiTargetsCard.metric.lead_velocity.unit": "leads/week",
    "kpiTargetsCard.metric.social_pending.label": "Social replies waiting",
    "kpiTargetsCard.metric.social_pending.hint":
      "Comments and DMs still open across connected social accounts.",
    "kpiTargetsCard.metric.social_pending.unit": "items",
    "kpiTargetsCard.metric.unread_backlog.label": "Unread chats",
    "kpiTargetsCard.metric.unread_backlog.hint":
      "Conversations with unread inbound messages right now.",
    "kpiTargetsCard.metric.unread_backlog.unit": "chats",
  },
  ar: {
    "kpiTargetsCard.advisorSetKpiTargets": "حدّد المستشار {saved} من أهداف مؤشرات الأداء",
    "kpiTargetsCard.theAdvisorCouldNotSet":
      "لم يتمكن المستشار من تحديد الأهداف بعد — أضف بيانات أكثر أولًا",
    "kpiTargetsCard.kpiTargetsSaved": "حُفظت أهداف مؤشرات الأداء",
    "kpiTargetsCard.kpiTargetsAlerts": "أهداف مؤشرات الأداء والتنبيهات",
    "kpiTargetsCard.responseTimeConversionLeadVelocity":
      "زمن الرد والتحويل وسرعة العملاء المحتملين وتراكم رسائل التواصل — تُقاس مباشرة مقابل الأهداف التي يحددها مستشارك.",
    "kpiTargetsCard.setting": "جارٍ التحديد…",
    "kpiTargetsCard.letAdvisorSetTargets": "دَع المستشار يحدد الأهداف",
    "kpiTargetsCard.checkNow": "افحص الآن",
    "kpiTargetsCard.resolve": "معالجة",
    "kpiTargetsCard.lowerIsBetter": "الأقل أفضل",
    "kpiTargetsCard.higherIsBetter": "الأعلى أفضل",
    "kpiTargetsCard.advisor": "المستشار",
    "kpiTargetsCard.offTarget": "خارج الهدف",
    "kpiTargetsCard.onTrack": "على المسار",
    "kpiTargetsCard.notEnoughData": "بيانات غير كافية",
    "kpiTargetsCard.now": "الآن: {span} · {value}",
    "kpiTargetsCard.target": "الهدف",
    "kpiTargetsCard.saveTargets": "حفظ الأهداف",
    "kpiTargetsCard.metric.response_minutes.label": "زمن أول رد",
    "kpiTargetsCard.metric.response_minutes.hint":
      "متوسط الدقائق قبل أن يرد موظف أو روبوت على محادثة واردة جديدة (30 يومًا).",
    "kpiTargetsCard.metric.response_minutes.unit": "دقيقة",
    "kpiTargetsCard.metric.read_rate.label": "معدل القراءة",
    "kpiTargetsCard.metric.read_rate.hint": "نسبة رسائل واتساب الصادرة التي قُرئت (30 يومًا).",
    "kpiTargetsCard.metric.conversion_rate.label": "تحويل العملاء المحتملين",
    "kpiTargetsCard.metric.conversion_rate.hint":
      "نسبة جهات الاتصال التي وصلت إلى مرحلة «تم الفوز».",
    "kpiTargetsCard.metric.lead_velocity.label": "سرعة العملاء المحتملين",
    "kpiTargetsCard.metric.lead_velocity.hint": "العملاء المحتملون الجدد خلال آخر 7 أيام.",
    "kpiTargetsCard.metric.lead_velocity.unit": "عميل/أسبوع",
    "kpiTargetsCard.metric.social_pending.label": "ردود التواصل المعلّقة",
    "kpiTargetsCard.metric.social_pending.hint":
      "التعليقات والرسائل الخاصة التي ما زالت مفتوحة في الحسابات المرتبطة.",
    "kpiTargetsCard.metric.social_pending.unit": "عنصر",
    "kpiTargetsCard.metric.unread_backlog.label": "محادثات غير مقروءة",
    "kpiTargetsCard.metric.unread_backlog.hint": "المحادثات التي فيها رسائل واردة غير مقروءة الآن.",
    "kpiTargetsCard.metric.unread_backlog.unit": "محادثة",
  },
  ms: {
    "kpiTargetsCard.advisorSetKpiTargets": "Penasihat menetapkan {saved} sasaran KPI",
    "kpiTargetsCard.theAdvisorCouldNotSet":
      "Penasihat belum dapat menetapkan sasaran — tambah lebih banyak data dahulu",
    "kpiTargetsCard.kpiTargetsSaved": "Sasaran KPI disimpan",
    "kpiTargetsCard.kpiTargetsAlerts": "Sasaran KPI & amaran",
    "kpiTargetsCard.responseTimeConversionLeadVelocity":
      "Masa respons, penukaran, kelajuan prospek dan tunggakan sosial — diukur secara langsung berbanding sasaran yang ditetapkan penasihat anda.",
    "kpiTargetsCard.setting": "Menetapkan…",
    "kpiTargetsCard.letAdvisorSetTargets": "Biar penasihat tetapkan sasaran",
    "kpiTargetsCard.checkNow": "Semak sekarang",
    "kpiTargetsCard.resolve": "Selesaikan",
    "kpiTargetsCard.lowerIsBetter": "lebih rendah lebih baik",
    "kpiTargetsCard.higherIsBetter": "lebih tinggi lebih baik",
    "kpiTargetsCard.advisor": "penasihat",
    "kpiTargetsCard.offTarget": "tersasar",
    "kpiTargetsCard.onTrack": "di landasan",
    "kpiTargetsCard.notEnoughData": "data tidak mencukupi",
    "kpiTargetsCard.now": "Kini: {span} · {value}",
    "kpiTargetsCard.target": "sasaran",
    "kpiTargetsCard.saveTargets": "Simpan sasaran",
    "kpiTargetsCard.metric.response_minutes.label": "Masa respons pertama",
    "kpiTargetsCard.metric.response_minutes.hint":
      "Purata minit sebelum manusia atau bot menjawab sembang masuk baharu (30 hari).",
    "kpiTargetsCard.metric.response_minutes.unit": "min",
    "kpiTargetsCard.metric.read_rate.label": "Kadar dibaca",
    "kpiTargetsCard.metric.read_rate.hint": "Bahagian mesej WhatsApp keluar yang dibaca (30 hari).",
    "kpiTargetsCard.metric.conversion_rate.label": "Penukaran prospek",
    "kpiTargetsCard.metric.conversion_rate.hint":
      "Bahagian kenalan yang mencapai peringkat Menang.",
    "kpiTargetsCard.metric.lead_velocity.label": "Kelajuan prospek",
    "kpiTargetsCard.metric.lead_velocity.hint":
      "Prospek baharu yang dikumpul dalam 7 hari terakhir.",
    "kpiTargetsCard.metric.lead_velocity.unit": "prospek/minggu",
    "kpiTargetsCard.metric.social_pending.label": "Balasan sosial menunggu",
    "kpiTargetsCard.metric.social_pending.hint":
      "Komen dan DM yang masih terbuka merentas akaun sosial yang disambungkan.",
    "kpiTargetsCard.metric.social_pending.unit": "item",
    "kpiTargetsCard.metric.unread_backlog.label": "Sembang belum dibaca",
    "kpiTargetsCard.metric.unread_backlog.hint":
      "Perbualan dengan mesej masuk yang belum dibaca sekarang.",
    "kpiTargetsCard.metric.unread_backlog.unit": "sembang",
  },
  fil: {
    "kpiTargetsCard.advisorSetKpiTargets": "Nagtakda ang advisor ng {saved} KPI target",
    "kpiTargetsCard.theAdvisorCouldNotSet":
      "Hindi pa makapagtakda ng target ang advisor — magdagdag muna ng data",
    "kpiTargetsCard.kpiTargetsSaved": "Na-save ang mga KPI target",
    "kpiTargetsCard.kpiTargetsAlerts": "Mga KPI target at alerto",
    "kpiTargetsCard.responseTimeConversionLeadVelocity":
      "Response time, conversion, lead velocity at social backlog — sinusukat nang live laban sa mga target na itinakda ng iyong advisor.",
    "kpiTargetsCard.setting": "Itinatakda…",
    "kpiTargetsCard.letAdvisorSetTargets": "Hayaang magtakda ng target ang advisor",
    "kpiTargetsCard.checkNow": "Suriin ngayon",
    "kpiTargetsCard.resolve": "Lutasin",
    "kpiTargetsCard.lowerIsBetter": "mas mababa, mas mabuti",
    "kpiTargetsCard.higherIsBetter": "mas mataas, mas mabuti",
    "kpiTargetsCard.advisor": "advisor",
    "kpiTargetsCard.offTarget": "wala sa target",
    "kpiTargetsCard.onTrack": "nasa tamang landas",
    "kpiTargetsCard.notEnoughData": "kulang ang data",
    "kpiTargetsCard.now": "Ngayon: {span} · {value}",
    "kpiTargetsCard.target": "target",
    "kpiTargetsCard.saveTargets": "I-save ang mga target",
    "kpiTargetsCard.metric.response_minutes.label": "Oras ng unang sagot",
    "kpiTargetsCard.metric.response_minutes.hint":
      "Average na minuto bago sumagot ang tao o bot sa bagong papasok na chat (30 araw).",
    "kpiTargetsCard.metric.response_minutes.unit": "min",
    "kpiTargetsCard.metric.read_rate.label": "Read rate",
    "kpiTargetsCard.metric.read_rate.hint":
      "Bahagi ng mga papalabas na mensahe sa WhatsApp na nabasa (30 araw).",
    "kpiTargetsCard.metric.conversion_rate.label": "Conversion ng lead",
    "kpiTargetsCard.metric.conversion_rate.hint": "Bahagi ng mga contact na umabot sa yugtong Won.",
    "kpiTargetsCard.metric.lead_velocity.label": "Lead velocity",
    "kpiTargetsCard.metric.lead_velocity.hint": "Mga bagong lead na nakuha sa huling 7 araw.",
    "kpiTargetsCard.metric.lead_velocity.unit": "lead/linggo",
    "kpiTargetsCard.metric.social_pending.label": "Mga social na sagot na naghihintay",
    "kpiTargetsCard.metric.social_pending.hint":
      "Mga komento at DM na bukas pa sa mga nakakonektang social account.",
    "kpiTargetsCard.metric.social_pending.unit": "item",
    "kpiTargetsCard.metric.unread_backlog.label": "Mga hindi pa nababasang chat",
    "kpiTargetsCard.metric.unread_backlog.hint":
      "Mga usapang may hindi pa nababasang papasok na mensahe sa ngayon.",
    "kpiTargetsCard.metric.unread_backlog.unit": "chat",
  },
  sw: {
    "kpiTargetsCard.advisorSetKpiTargets": "Mshauri ameweka malengo {saved} ya KPI",
    "kpiTargetsCard.theAdvisorCouldNotSet":
      "Mshauri bado hajaweza kuweka malengo — ongeza data zaidi kwanza",
    "kpiTargetsCard.kpiTargetsSaved": "Malengo ya KPI yamehifadhiwa",
    "kpiTargetsCard.kpiTargetsAlerts": "Malengo ya KPI na tahadhari",
    "kpiTargetsCard.responseTimeConversionLeadVelocity":
      "Muda wa kujibu, ubadilishaji, kasi ya wateja watarajiwa na mrundikano wa mitandao — hupimwa moja kwa moja dhidi ya malengo anayoweka mshauri wako.",
    "kpiTargetsCard.setting": "Inaweka…",
    "kpiTargetsCard.letAdvisorSetTargets": "Acha mshauri aweke malengo",
    "kpiTargetsCard.checkNow": "Kagua sasa",
    "kpiTargetsCard.resolve": "Tatua",
    "kpiTargetsCard.lowerIsBetter": "chini ni bora",
    "kpiTargetsCard.higherIsBetter": "juu ni bora",
    "kpiTargetsCard.advisor": "mshauri",
    "kpiTargetsCard.offTarget": "nje ya lengo",
    "kpiTargetsCard.onTrack": "kwenye mstari",
    "kpiTargetsCard.notEnoughData": "data haitoshi",
    "kpiTargetsCard.now": "Sasa: {span} · {value}",
    "kpiTargetsCard.target": "lengo",
    "kpiTargetsCard.saveTargets": "Hifadhi malengo",
    "kpiTargetsCard.metric.response_minutes.label": "Muda wa jibu la kwanza",
    "kpiTargetsCard.metric.response_minutes.hint":
      "Wastani wa dakika kabla mtu au roboti kujibu gumzo jipya linaloingia (siku 30).",
    "kpiTargetsCard.metric.response_minutes.unit": "dak",
    "kpiTargetsCard.metric.read_rate.label": "Kiwango cha kusomwa",
    "kpiTargetsCard.metric.read_rate.hint":
      "Sehemu ya ujumbe wa WhatsApp uliotumwa ambao ulisomwa (siku 30).",
    "kpiTargetsCard.metric.conversion_rate.label": "Ubadilishaji wa wateja watarajiwa",
    "kpiTargetsCard.metric.conversion_rate.hint": "Sehemu ya anwani zilizofika hatua ya Ushindi.",
    "kpiTargetsCard.metric.lead_velocity.label": "Kasi ya wateja watarajiwa",
    "kpiTargetsCard.metric.lead_velocity.hint":
      "Wateja watarajiwa wapya waliopatikana katika siku 7 zilizopita.",
    "kpiTargetsCard.metric.lead_velocity.unit": "wateja/wiki",
    "kpiTargetsCard.metric.social_pending.label": "Majibu ya mitandao yanayosubiri",
    "kpiTargetsCard.metric.social_pending.hint":
      "Maoni na DM ambazo bado ziko wazi katika akaunti za mitandao zilizounganishwa.",
    "kpiTargetsCard.metric.social_pending.unit": "vipengee",
    "kpiTargetsCard.metric.unread_backlog.label": "Gumzo zisizosomwa",
    "kpiTargetsCard.metric.unread_backlog.hint":
      "Mazungumzo yenye ujumbe unaoingia ambao haujasomwa kwa sasa.",
    "kpiTargetsCard.metric.unread_backlog.unit": "gumzo",
  },
});
