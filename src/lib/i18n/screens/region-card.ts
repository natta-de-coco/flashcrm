// Text for the "regionCard" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "regionCard.regionalSettingsSaved": "Regional settings saved.",
    "regionCard.regionCurrencyLanguage": "Region, currency & language",
    "regionCard.flasAdaptsToWhereYour":
      "Flas adapts to where your business operates: invoices, dates, campaign timing and the marketing rules we enforce all follow this.",
    "regionCard.country": "Country",
    "regionCard.currency": "Currency",
    "regionCard.companyLanguage": "Company language",
    "regionCard.theInterfaceLanguageForTeammates":
      "The interface language for teammates who have not chosen their own. Anyone can change theirs from the language menu. English, Arabic, Malay, Filipino and Swahili are available; other languages show English for now.",
    "regionCard.timezone": "Timezone",
    "regionCard.preview": "Preview: {formatMoney} · {format}",
    "regionCard.saving": "Saving…",
    "regionCard.saveRegionalSettings": "Save regional settings",
    "regionCard.searchCountry": "Search by name, code or +calling code…",
    "regionCard.noCountryMatches": "No country matches.",
    "regionCard.searchCurrency": "Search currencies…",
    "regionCard.noCurrencyMatches": "No currency matches.",
    "regionCard.searchTimezone": "Search a city or GMT offset…",
    "regionCard.noTimezoneMatches": "No timezone matches.",
    "regionCard.compliance.eu.label": "EU — GDPR & ePrivacy",
    "regionCard.compliance.eu.rule.0":
      "Freely given, recorded opt-in before the first marketing message.",
    "regionCard.compliance.eu.rule.1": "One-click unsubscribe and STOP handling in every campaign.",
    "regionCard.compliance.eu.rule.2": "Honour access and erasure requests within 30 days.",
    "regionCard.compliance.eu.rule.3":
      "Keep the lawful basis and consent timestamp on every contact.",
    "regionCard.compliance.uk.label": "UK — UK GDPR & PECR",
    "regionCard.compliance.uk.rule.0":
      "Recorded opt-in, or a genuine soft opt-in from an existing purchase.",
    "regionCard.compliance.uk.rule.1":
      "Identify the sender and provide an opt-out in every message.",
    "regionCard.compliance.uk.rule.2":
      "Screen against your own suppression list before every send.",
    "regionCard.compliance.us.label": "US — TCPA & CAN-SPAM",
    "regionCard.compliance.us.rule.0": "Prior express written consent for marketing SMS/WhatsApp.",
    "regionCard.compliance.us.rule.1": "Honour STOP immediately and keep the proof of consent.",
    "regionCard.compliance.us.rule.2": "No sends outside 8am–9pm in the contact's own timezone.",
    "regionCard.compliance.us.rule.3": "Postal address and unsubscribe in every marketing email.",
    "regionCard.compliance.canada.label": "Canada — CASL",
    "regionCard.compliance.canada.rule.0":
      "Express or documented implied consent, with the source recorded.",
    "regionCard.compliance.canada.rule.1":
      "Sender identification and a working unsubscribe in every message.",
    "regionCard.compliance.canada.rule.2": "Implied consent expires — re-confirm within 24 months.",
    "regionCard.compliance.gcc.label": "Gulf — UAE PDPL / KSA PDPL & TRA rules",
    "regionCard.compliance.gcc.rule.0":
      "Registered sender identity and recorded opt-in for promotions.",
    "regionCard.compliance.gcc.rule.1": "Arabic-friendly opt-out wording alongside English.",
    "regionCard.compliance.gcc.rule.2": "Respect Friday/holiday and night-time quiet hours.",
    "regionCard.compliance.india.label": "India — DPDP Act & TRAI",
    "regionCard.compliance.india.rule.0":
      "Consent notice in the contact's language, with a withdrawal path.",
    "regionCard.compliance.india.rule.1":
      "Use registered templates and headers for commercial messaging.",
    "regionCard.compliance.india.rule.2":
      "No promotional messages during TRAI restricted hours (9pm–9am).",
    "regionCard.compliance.apac.label": "APAC — PDPA family",
    "regionCard.compliance.apac.rule.0": "Recorded opt-in and a per-channel withdrawal option.",
    "regionCard.compliance.apac.rule.1":
      "Check national do-not-call registries before promotional sends.",
    "regionCard.compliance.apac.rule.2":
      "Keep data-transfer notices when hosting outside the country.",
    "regionCard.compliance.global.label": "General best practice",
    "regionCard.compliance.global.rule.0": "Only message people who asked to hear from you.",
    "regionCard.compliance.global.rule.1": "Always offer an opt-out and honour it immediately.",
    "regionCard.compliance.global.rule.2": "Keep the consent source and timestamp on record.",
  },
  ar: {
    "regionCard.regionalSettingsSaved": "حُفظت الإعدادات الإقليمية.",
    "regionCard.regionCurrencyLanguage": "المنطقة والعملة واللغة",
    "regionCard.flasAdaptsToWhereYour":
      "يتكيف Flas مع مكان عمل نشاطك: الفواتير والتواريخ وتوقيت الحملات وقواعد التسويق التي نطبقها كلها تتبع هذا.",
    "regionCard.country": "البلد",
    "regionCard.currency": "العملة",
    "regionCard.companyLanguage": "لغة الشركة",
    "regionCard.theInterfaceLanguageForTeammates":
      "لغة الواجهة لأعضاء الفريق الذين لم يختاروا لغتهم. يمكن لأي شخص تغيير لغته من قائمة اللغات. تتوفر الإنجليزية والعربية والملايوية والفلبينية والسواحيلية؛ واللغات الأخرى تعرض الإنجليزية حاليًا.",
    "regionCard.timezone": "المنطقة الزمنية",
    "regionCard.preview": "معاينة: {formatMoney} · {format}",
    "regionCard.saving": "جارٍ الحفظ…",
    "regionCard.saveRegionalSettings": "حفظ الإعدادات الإقليمية",
    "regionCard.searchCountry": "ابحث بالاسم أو الرمز أو مفتاح الاتصال الدولي…",
    "regionCard.noCountryMatches": "لا يوجد بلد مطابق.",
    "regionCard.searchCurrency": "ابحث في العملات…",
    "regionCard.noCurrencyMatches": "لا توجد عملة مطابقة.",
    "regionCard.searchTimezone": "ابحث عن مدينة أو فارق التوقيت GMT…",
    "regionCard.noTimezoneMatches": "لا توجد منطقة زمنية مطابقة.",
    "regionCard.compliance.eu.label": "الاتحاد الأوروبي — GDPR وePrivacy",
    "regionCard.compliance.eu.rule.0": "موافقة حرة ومسجَّلة قبل أول رسالة تسويقية.",
    "regionCard.compliance.eu.rule.1": "إلغاء اشتراك بنقرة واحدة ومعالجة كلمة STOP في كل حملة.",
    "regionCard.compliance.eu.rule.2": "تلبية طلبات الوصول والمحو خلال 30 يومًا.",
    "regionCard.compliance.eu.rule.3": "الاحتفاظ بالأساس القانوني وتوقيت الموافقة لكل جهة اتصال.",
    "regionCard.compliance.uk.label": "المملكة المتحدة — UK GDPR وPECR",
    "regionCard.compliance.uk.rule.0":
      "موافقة مسجَّلة، أو موافقة ضمنية حقيقية ناتجة عن عملية شراء سابقة.",
    "regionCard.compliance.uk.rule.1": "عرّف بالمرسِل ووفّر خيار إلغاء الاشتراك في كل رسالة.",
    "regionCard.compliance.uk.rule.2": "راجع قائمة الحظر الخاصة بك قبل كل إرسال.",
    "regionCard.compliance.us.label": "الولايات المتحدة — TCPA وCAN-SPAM",
    "regionCard.compliance.us.rule.0": "موافقة خطية صريحة مسبقة للرسائل التسويقية عبر SMS/واتساب.",
    "regionCard.compliance.us.rule.1": "استجب لكلمة STOP فورًا واحتفظ بإثبات الموافقة.",
    "regionCard.compliance.us.rule.2":
      "لا إرسال خارج الفترة من 8 صباحًا إلى 9 مساءً بتوقيت جهة الاتصال.",
    "regionCard.compliance.us.rule.3": "العنوان البريدي ورابط إلغاء الاشتراك في كل بريد تسويقي.",
    "regionCard.compliance.canada.label": "كندا — CASL",
    "regionCard.compliance.canada.rule.0": "موافقة صريحة أو ضمنية موثَّقة، مع تسجيل المصدر.",
    "regionCard.compliance.canada.rule.1": "تعريف بالمرسِل وإلغاء اشتراك يعمل في كل رسالة.",
    "regionCard.compliance.canada.rule.2": "الموافقة الضمنية تنتهي — جدّد التأكيد خلال 24 شهرًا.",
    "regionCard.compliance.gcc.label":
      "الخليج — قانون حماية البيانات الإماراتي / السعودي وقواعد هيئة الاتصالات",
    "regionCard.compliance.gcc.rule.0": "هوية مرسِل مسجَّلة وموافقة مسجَّلة للعروض الترويجية.",
    "regionCard.compliance.gcc.rule.1": "صياغة إلغاء اشتراك بالعربية إلى جانب الإنجليزية.",
    "regionCard.compliance.gcc.rule.2": "احترم ساعات الهدوء يوم الجمعة وفي العطل وفي الليل.",
    "regionCard.compliance.india.label": "الهند — قانون DPDP وهيئة TRAI",
    "regionCard.compliance.india.rule.0": "إشعار موافقة بلغة جهة الاتصال، مع وسيلة للسحب.",
    "regionCard.compliance.india.rule.1": "استخدم القوالب والعناوين المسجَّلة للرسائل التجارية.",
    "regionCard.compliance.india.rule.2":
      "لا رسائل ترويجية خلال ساعات الحظر لدى TRAI (9 مساءً–9 صباحًا).",
    "regionCard.compliance.apac.label": "آسيا والمحيط الهادئ — قوانين PDPA",
    "regionCard.compliance.apac.rule.0": "موافقة مسجَّلة وخيار سحب لكل قناة.",
    "regionCard.compliance.apac.rule.1": "راجع سجلات «عدم الاتصال» الوطنية قبل الإرسال الترويجي.",
    "regionCard.compliance.apac.rule.2": "احتفظ بإشعارات نقل البيانات عند الاستضافة خارج البلد.",
    "regionCard.compliance.global.label": "أفضل الممارسات العامة",
    "regionCard.compliance.global.rule.0": "راسل فقط من طلبوا أن تصلهم رسائلك.",
    "regionCard.compliance.global.rule.1": "وفّر دائمًا خيار إلغاء الاشتراك واستجب له فورًا.",
    "regionCard.compliance.global.rule.2": "احتفظ بمصدر الموافقة وتوقيتها في السجل.",
  },
  ms: {
    "regionCard.regionalSettingsSaved": "Tetapan serantau disimpan.",
    "regionCard.regionCurrencyLanguage": "Rantau, mata wang & bahasa",
    "regionCard.flasAdaptsToWhereYour":
      "Flas menyesuaikan diri dengan tempat perniagaan anda beroperasi: invois, tarikh, masa kempen dan peraturan pemasaran yang kami kuatkuasakan semuanya mengikut ini.",
    "regionCard.country": "Negara",
    "regionCard.currency": "Mata wang",
    "regionCard.companyLanguage": "Bahasa syarikat",
    "regionCard.theInterfaceLanguageForTeammates":
      "Bahasa antara muka untuk rakan sepasukan yang belum memilih sendiri. Sesiapa sahaja boleh menukar bahasa mereka dari menu bahasa. Bahasa Inggeris, Arab, Melayu, Filipina dan Swahili tersedia; bahasa lain memaparkan bahasa Inggeris buat masa ini.",
    "regionCard.timezone": "Zon waktu",
    "regionCard.preview": "Pratonton: {formatMoney} · {format}",
    "regionCard.saving": "Menyimpan…",
    "regionCard.saveRegionalSettings": "Simpan tetapan serantau",
    "regionCard.searchCountry": "Cari mengikut nama, kod atau +kod panggilan…",
    "regionCard.noCountryMatches": "Tiada negara yang sepadan.",
    "regionCard.searchCurrency": "Cari mata wang…",
    "regionCard.noCurrencyMatches": "Tiada mata wang yang sepadan.",
    "regionCard.searchTimezone": "Cari bandar atau ofset GMT…",
    "regionCard.noTimezoneMatches": "Tiada zon waktu yang sepadan.",
    "regionCard.compliance.eu.label": "EU — GDPR & ePrivacy",
    "regionCard.compliance.eu.rule.0":
      "Persetujuan yang diberi secara bebas dan direkodkan sebelum mesej pemasaran pertama.",
    "regionCard.compliance.eu.rule.1":
      "Nyahlanggan satu klik dan pengendalian STOP dalam setiap kempen.",
    "regionCard.compliance.eu.rule.2":
      "Tunaikan permintaan akses dan pemadaman dalam masa 30 hari.",
    "regionCard.compliance.eu.rule.3":
      "Simpan asas undang-undang dan cap masa persetujuan pada setiap kenalan.",
    "regionCard.compliance.uk.label": "UK — UK GDPR & PECR",
    "regionCard.compliance.uk.rule.0":
      "Persetujuan yang direkodkan, atau persetujuan tersirat yang sah daripada pembelian sedia ada.",
    "regionCard.compliance.uk.rule.1":
      "Kenal pasti pengirim dan sediakan pilihan berhenti dalam setiap mesej.",
    "regionCard.compliance.uk.rule.2":
      "Saring dengan senarai penindasan anda sendiri sebelum setiap penghantaran.",
    "regionCard.compliance.us.label": "AS — TCPA & CAN-SPAM",
    "regionCard.compliance.us.rule.0":
      "Persetujuan bertulis yang nyata terlebih dahulu untuk SMS/WhatsApp pemasaran.",
    "regionCard.compliance.us.rule.1": "Patuhi STOP serta-merta dan simpan bukti persetujuan.",
    "regionCard.compliance.us.rule.2":
      "Tiada penghantaran di luar 8 pagi–9 malam mengikut zon waktu kenalan itu sendiri.",
    "regionCard.compliance.us.rule.3":
      "Alamat pos dan pautan nyahlanggan dalam setiap e-mel pemasaran.",
    "regionCard.compliance.canada.label": "Kanada — CASL",
    "regionCard.compliance.canada.rule.0":
      "Persetujuan nyata atau tersirat yang didokumenkan, dengan sumber direkodkan.",
    "regionCard.compliance.canada.rule.1":
      "Pengenalan pengirim dan nyahlanggan yang berfungsi dalam setiap mesej.",
    "regionCard.compliance.canada.rule.2":
      "Persetujuan tersirat tamat tempoh — sahkan semula dalam masa 24 bulan.",
    "regionCard.compliance.gcc.label": "Teluk — UAE PDPL / KSA PDPL & peraturan TRA",
    "regionCard.compliance.gcc.rule.0":
      "Identiti pengirim berdaftar dan persetujuan yang direkodkan untuk promosi.",
    "regionCard.compliance.gcc.rule.1":
      "Perkataan berhenti langganan yang mesra bahasa Arab di samping bahasa Inggeris.",
    "regionCard.compliance.gcc.rule.2":
      "Hormati waktu senyap pada hari Jumaat/cuti dan waktu malam.",
    "regionCard.compliance.india.label": "India — Akta DPDP & TRAI",
    "regionCard.compliance.india.rule.0":
      "Notis persetujuan dalam bahasa kenalan, dengan cara untuk menarik balik.",
    "regionCard.compliance.india.rule.1":
      "Gunakan templat dan pengepala berdaftar untuk pemesejan komersial.",
    "regionCard.compliance.india.rule.2":
      "Tiada mesej promosi semasa waktu larangan TRAI (9 malam–9 pagi).",
    "regionCard.compliance.apac.label": "APAC — keluarga PDPA",
    "regionCard.compliance.apac.rule.0":
      "Persetujuan yang direkodkan dan pilihan menarik balik bagi setiap saluran.",
    "regionCard.compliance.apac.rule.1":
      "Semak daftar jangan-hubungi kebangsaan sebelum penghantaran promosi.",
    "regionCard.compliance.apac.rule.2":
      "Simpan notis pemindahan data apabila mengehos di luar negara.",
    "regionCard.compliance.global.label": "Amalan terbaik umum",
    "regionCard.compliance.global.rule.0":
      "Hantar mesej hanya kepada orang yang meminta untuk menerimanya.",
    "regionCard.compliance.global.rule.1":
      "Sentiasa tawarkan pilihan berhenti dan patuhinya serta-merta.",
    "regionCard.compliance.global.rule.2": "Simpan sumber dan cap masa persetujuan dalam rekod.",
  },
  fil: {
    "regionCard.regionalSettingsSaved": "Na-save ang mga regional na setting.",
    "regionCard.regionCurrencyLanguage": "Rehiyon, currency at wika",
    "regionCard.flasAdaptsToWhereYour":
      "Umaangkop ang Flas sa kung saan nag-o-operate ang iyong negosyo: sinusunod nito ang lahat — mga invoice, petsa, timing ng campaign at mga tuntunin sa marketing na ipinapatupad namin.",
    "regionCard.country": "Bansa",
    "regionCard.currency": "Currency",
    "regionCard.companyLanguage": "Wika ng kumpanya",
    "regionCard.theInterfaceLanguageForTeammates":
      "Ang wika ng interface para sa mga ka-team na hindi pa pumipili ng sarili nila. Maaaring palitan ng sinuman ang kanila mula sa menu ng wika. Available ang English, Arabic, Malay, Filipino at Swahili; English muna ang ipinapakita ng ibang wika.",
    "regionCard.timezone": "Timezone",
    "regionCard.preview": "Preview: {formatMoney} · {format}",
    "regionCard.saving": "Sine-save…",
    "regionCard.saveRegionalSettings": "I-save ang mga regional na setting",
    "regionCard.searchCountry": "Maghanap ayon sa pangalan, code o +calling code…",
    "regionCard.noCountryMatches": "Walang tumutugmang bansa.",
    "regionCard.searchCurrency": "Maghanap ng currency…",
    "regionCard.noCurrencyMatches": "Walang tumutugmang currency.",
    "regionCard.searchTimezone": "Maghanap ng lungsod o GMT offset…",
    "regionCard.noTimezoneMatches": "Walang tumutugmang timezone.",
    "regionCard.compliance.eu.label": "EU — GDPR at ePrivacy",
    "regionCard.compliance.eu.rule.0":
      "Malayang ibinigay at naitalang opt-in bago ang unang marketing na mensahe.",
    "regionCard.compliance.eu.rule.1":
      "One-click na unsubscribe at paghawak ng STOP sa bawat campaign.",
    "regionCard.compliance.eu.rule.2":
      "Tuparin ang mga kahilingan sa access at pagbura sa loob ng 30 araw.",
    "regionCard.compliance.eu.rule.3":
      "Itago ang legal na batayan at oras ng pahintulot sa bawat contact.",
    "regionCard.compliance.uk.label": "UK — UK GDPR at PECR",
    "regionCard.compliance.uk.rule.0":
      "Naitalang opt-in, o tunay na soft opt-in mula sa dating pagbili.",
    "regionCard.compliance.uk.rule.1":
      "Ipakilala ang nagpadala at maglagay ng opt-out sa bawat mensahe.",
    "regionCard.compliance.uk.rule.2":
      "I-screen laban sa sarili mong suppression list bago ang bawat pagpapadala.",
    "regionCard.compliance.us.label": "US — TCPA at CAN-SPAM",
    "regionCard.compliance.us.rule.0":
      "Paunang hayag at nakasulat na pahintulot para sa marketing na SMS/WhatsApp.",
    "regionCard.compliance.us.rule.1": "Sundin agad ang STOP at itago ang patunay ng pahintulot.",
    "regionCard.compliance.us.rule.2":
      "Walang pagpapadala sa labas ng 8am–9pm sa sariling timezone ng contact.",
    "regionCard.compliance.us.rule.3": "Postal address at unsubscribe sa bawat marketing na email.",
    "regionCard.compliance.canada.label": "Canada — CASL",
    "regionCard.compliance.canada.rule.0":
      "Hayag o dokumentadong ipinahiwatig na pahintulot, na nakatala ang pinagmulan.",
    "regionCard.compliance.canada.rule.1":
      "Pagkakakilanlan ng nagpadala at gumaganang unsubscribe sa bawat mensahe.",
    "regionCard.compliance.canada.rule.2":
      "Nag-e-expire ang ipinahiwatig na pahintulot — kumpirmahin muli sa loob ng 24 buwan.",
    "regionCard.compliance.gcc.label": "Gulf — UAE PDPL / KSA PDPL at mga tuntunin ng TRA",
    "regionCard.compliance.gcc.rule.0":
      "Rehistradong pagkakakilanlan ng nagpadala at naitalang opt-in para sa mga promosyon.",
    "regionCard.compliance.gcc.rule.1": "Opt-out na may wikang Arabic kasama ng English.",
    "regionCard.compliance.gcc.rule.2":
      "Igalang ang tahimik na oras tuwing Biyernes/holiday at sa gabi.",
    "regionCard.compliance.india.label": "India — DPDP Act at TRAI",
    "regionCard.compliance.india.rule.0":
      "Abiso ng pahintulot sa wika ng contact, na may paraan para bawiin.",
    "regionCard.compliance.india.rule.1":
      "Gumamit ng mga rehistradong template at header para sa komersyal na mensahe.",
    "regionCard.compliance.india.rule.2":
      "Walang promotional na mensahe sa mga oras na ipinagbabawal ng TRAI (9pm–9am).",
    "regionCard.compliance.apac.label": "APAC — mga batas na PDPA",
    "regionCard.compliance.apac.rule.0": "Naitalang opt-in at opsyon sa pagbawi kada channel.",
    "regionCard.compliance.apac.rule.1":
      "Tingnan ang mga pambansang do-not-call registry bago magpadala ng promosyon.",
    "regionCard.compliance.apac.rule.2":
      "Itago ang mga abiso sa paglilipat ng data kapag nagho-host sa labas ng bansa.",
    "regionCard.compliance.global.label": "Pangkalahatang pinakamahusay na gawi",
    "regionCard.compliance.global.rule.0":
      "Mensahehan lang ang mga taong humiling na makarinig mula sa iyo.",
    "regionCard.compliance.global.rule.1": "Laging mag-alok ng opt-out at sundin ito agad.",
    "regionCard.compliance.global.rule.2": "Itago sa record ang pinagmulan at oras ng pahintulot.",
  },
  sw: {
    "regionCard.regionalSettingsSaved": "Mipangilio ya eneo imehifadhiwa.",
    "regionCard.regionCurrencyLanguage": "Eneo, sarafu na lugha",
    "regionCard.flasAdaptsToWhereYour":
      "Flas hujirekebisha kulingana na mahali biashara yako inapofanya kazi: ankara, tarehe, muda wa kampeni na kanuni za masoko tunazotekeleza vyote hufuata hili.",
    "regionCard.country": "Nchi",
    "regionCard.currency": "Sarafu",
    "regionCard.companyLanguage": "Lugha ya kampuni",
    "regionCard.theInterfaceLanguageForTeammates":
      "Lugha ya kiolesura kwa wenzako ambao hawajachagua yao. Yeyote anaweza kubadilisha yake kutoka menyu ya lugha. Kiingereza, Kiarabu, Kimalei, Kifilipino na Kiswahili zinapatikana; lugha nyingine huonyesha Kiingereza kwa sasa.",
    "regionCard.timezone": "Saa za eneo",
    "regionCard.preview": "Onyesho: {formatMoney} · {format}",
    "regionCard.saving": "Inahifadhi…",
    "regionCard.saveRegionalSettings": "Hifadhi mipangilio ya eneo",
    "regionCard.searchCountry": "Tafuta kwa jina, msimbo au +msimbo wa simu…",
    "regionCard.noCountryMatches": "Hakuna nchi inayolingana.",
    "regionCard.searchCurrency": "Tafuta sarafu…",
    "regionCard.noCurrencyMatches": "Hakuna sarafu inayolingana.",
    "regionCard.searchTimezone": "Tafuta jiji au tofauti ya GMT…",
    "regionCard.noTimezoneMatches": "Hakuna saa za eneo zinazolingana.",
    "regionCard.compliance.eu.label": "EU — GDPR na ePrivacy",
    "regionCard.compliance.eu.rule.0":
      "Idhini iliyotolewa kwa hiari na kurekodiwa kabla ya ujumbe wa kwanza wa masoko.",
    "regionCard.compliance.eu.rule.1":
      "Kujiondoa kwa mbofyo mmoja na kushughulikia STOP katika kila kampeni.",
    "regionCard.compliance.eu.rule.2": "Tekeleza maombi ya ufikiaji na ufutaji ndani ya siku 30.",
    "regionCard.compliance.eu.rule.3":
      "Hifadhi msingi wa kisheria na muda wa idhini kwa kila anwani.",
    "regionCard.compliance.uk.label": "UK — UK GDPR na PECR",
    "regionCard.compliance.uk.rule.0":
      "Idhini iliyorekodiwa, au idhini halisi isiyo ya moja kwa moja kutokana na ununuzi uliopo.",
    "regionCard.compliance.uk.rule.1":
      "Mtambulishe mtumaji na utoe njia ya kujiondoa katika kila ujumbe.",
    "regionCard.compliance.uk.rule.2":
      "Chuja dhidi ya orodha yako ya waliozuiwa kabla ya kila utumaji.",
    "regionCard.compliance.us.label": "Marekani — TCPA na CAN-SPAM",
    "regionCard.compliance.us.rule.0":
      "Idhini ya awali ya maandishi iliyo wazi kwa SMS/WhatsApp za masoko.",
    "regionCard.compliance.us.rule.1": "Tekeleza STOP mara moja na uhifadhi uthibitisho wa idhini.",
    "regionCard.compliance.us.rule.2":
      "Hakuna utumaji nje ya saa 2 asubuhi–3 usiku kwa saa za eneo la anwani.",
    "regionCard.compliance.us.rule.3":
      "Anwani ya posta na njia ya kujiondoa katika kila barua pepe ya masoko.",
    "regionCard.compliance.canada.label": "Kanada — CASL",
    "regionCard.compliance.canada.rule.0":
      "Idhini ya wazi au isiyo ya moja kwa moja iliyoandikwa, chanzo kikiwa kimerekodiwa.",
    "regionCard.compliance.canada.rule.1":
      "Utambulisho wa mtumaji na njia inayofanya kazi ya kujiondoa katika kila ujumbe.",
    "regionCard.compliance.canada.rule.2":
      "Idhini isiyo ya moja kwa moja huisha muda — thibitisha tena ndani ya miezi 24.",
    "regionCard.compliance.gcc.label": "Ghuba — UAE PDPL / KSA PDPL na kanuni za TRA",
    "regionCard.compliance.gcc.rule.0":
      "Utambulisho wa mtumaji uliosajiliwa na idhini iliyorekodiwa kwa matangazo.",
    "regionCard.compliance.gcc.rule.1": "Maneno ya kujiondoa kwa Kiarabu pamoja na Kiingereza.",
    "regionCard.compliance.gcc.rule.2": "Heshimu saa za utulivu za Ijumaa/sikukuu na usiku.",
    "regionCard.compliance.india.label": "India — Sheria ya DPDP na TRAI",
    "regionCard.compliance.india.rule.0":
      "Notisi ya idhini kwa lugha ya anwani, pamoja na njia ya kuiondoa.",
    "regionCard.compliance.india.rule.1":
      "Tumia violezo na vichwa vilivyosajiliwa kwa ujumbe wa kibiashara.",
    "regionCard.compliance.india.rule.2":
      "Hakuna ujumbe wa matangazo wakati wa saa zilizozuiwa na TRAI (saa 3 usiku–saa 3 asubuhi).",
    "regionCard.compliance.apac.label": "APAC — sheria za PDPA",
    "regionCard.compliance.apac.rule.0":
      "Idhini iliyorekodiwa na chaguo la kujiondoa kwa kila chaneli.",
    "regionCard.compliance.apac.rule.1":
      "Kagua rejista za kitaifa za usipigiwe-simu kabla ya kutuma matangazo.",
    "regionCard.compliance.apac.rule.2":
      "Hifadhi notisi za uhamishaji wa data unapohifadhi nje ya nchi.",
    "regionCard.compliance.global.label": "Mbinu bora za jumla",
    "regionCard.compliance.global.rule.0":
      "Tuma ujumbe kwa watu walioomba kusikia kutoka kwako pekee.",
    "regionCard.compliance.global.rule.1": "Daima toa njia ya kujiondoa na uitekeleze mara moja.",
    "regionCard.compliance.global.rule.2": "Hifadhi chanzo na muda wa idhini kwenye rekodi.",
  },
});
