// Text for the "aiKeysCard" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "aiKeysCard.couldNotTestTheProvider": "Could not test the provider",
    "aiKeysCard.couldNotSaveBackupSettings": "Could not save backup settings",
    "aiKeysCard.keySavedTestTheConnection": "Key saved. Test the connection before relying on it.",
    "aiKeysCard.couldNotSaveTheKey": "Could not save the key",
    "aiKeysCard.keyRemovedTheNewestRemaining":
      "Key removed. The newest remaining key, or built-in Flas AI, will be used.",
    "aiKeysCard.couldNotRemoveTheKey": "Could not remove the key",
    "aiKeysCard.yourOwnAiKeys": "Your own AI keys",
    "aiKeysCard.addOpenaiClaudeOrGemini":
      "Add OpenAI, Claude or Gemini. The most recently saved active provider is tried first. A saved key is not a connection test. Provider billing and limits still apply.",
    "aiKeysCard.savedNotAHealthCheck": "saved · not a health check",
    "aiKeysCard.addedKeyHiddenForSafety": "Added {toLocaleDateString} · key hidden for safety",
    "aiKeysCard.checked": "{message} Checked {toLocaleTimeString}.",
    "aiKeysCard.testConnection": "Test connection",
    "aiKeysCard.remove": "Remove",
    "aiKeysCard.useBackupAiWhenThe": "Use backup AI when the primary provider fails",
    "aiKeysCard.withBackupsEnabledTheSame":
      "With backups enabled, the same prompt and business context may go to your other saved providers, newest first, then built-in Flas AI. Their usage charges apply. Workspace limits still apply, and safety refusals are never retried with another provider.",
    "aiKeysCard.backupSettingsNeedTheAi":
      "Backup settings need the AI database migration. Ask your platform admin to finish setup.",
    "aiKeysCard.testBuiltInAi": "Test built-in AI",
    "aiKeysCard.testsSendOnlyAShort":
      "Tests send only a short test prompt, not customer conversations.",
    "aiKeysCard.apiKey": "API key",
    "aiKeysCard.open": "Open",
    "aiKeysCard.replaceKey": "Replace key",
    "aiKeysCard.saveKey": "Save key",
    "aiKeysCard.newAndReplacedKeysAre":
      "New and replaced keys are encrypted before storage and never returned to your browser. To change a key, paste its replacement here.",
    "aiKeysCard.onlyACompanyAdminCan": "Only a company admin can add or change AI keys.",
  },
  ar: {
    "aiKeysCard.couldNotTestTheProvider": "تعذّر اختبار المزوّد",
    "aiKeysCard.couldNotSaveBackupSettings": "تعذّر حفظ إعدادات النسخ الاحتياطي",
    "aiKeysCard.keySavedTestTheConnection": "حُفظ المفتاح. اختبر الاتصال قبل الاعتماد عليه.",
    "aiKeysCard.couldNotSaveTheKey": "تعذّر حفظ المفتاح",
    "aiKeysCard.keyRemovedTheNewestRemaining":
      "أُزيل المفتاح. سيُستخدم أحدث مفتاح متبقٍّ، أو Flas AI المدمج.",
    "aiKeysCard.couldNotRemoveTheKey": "تعذّرت إزالة المفتاح",
    "aiKeysCard.yourOwnAiKeys": "مفاتيح الذكاء الاصطناعي الخاصة بك",
    "aiKeysCard.addOpenaiClaudeOrGemini":
      "أضف OpenAI أو Claude أو Gemini. يُجرَّب أولًا المزوّد النشط المحفوظ حديثًا. حفظ المفتاح ليس اختبارًا للاتصال. فوترة المزوّد وحدوده تبقى سارية.",
    "aiKeysCard.savedNotAHealthCheck": "محفوظ · ليس فحصًا للحالة",
    "aiKeysCard.addedKeyHiddenForSafety": "أُضيف {toLocaleDateString} · المفتاح مخفي للأمان",
    "aiKeysCard.checked": "{message} فُحص {toLocaleTimeString}.",
    "aiKeysCard.testConnection": "اختبار الاتصال",
    "aiKeysCard.remove": "إزالة",
    "aiKeysCard.useBackupAiWhenThe": "استخدم ذكاءً اصطناعيًا احتياطيًا عند تعطل المزوّد الأساسي",
    "aiKeysCard.withBackupsEnabledTheSame":
      "عند تفعيل الاحتياط، قد يُرسل الطلب نفسه وسياق نشاطك إلى مزوّديك المحفوظين الآخرين، الأحدث أولًا، ثم إلى Flas AI المدمج. تسري رسوم استخدامهم. حدود مساحة العمل تبقى سارية، ولا تُعاد محاولة الرفض لأسباب تتعلق بالسلامة مع مزوّد آخر أبدًا.",
    "aiKeysCard.backupSettingsNeedTheAi":
      "إعدادات الاحتياط تحتاج ترحيل قاعدة بيانات الذكاء الاصطناعي. اطلب من مسؤول المنصة إكمال الإعداد.",
    "aiKeysCard.testBuiltInAi": "اختبار الذكاء الاصطناعي المدمج",
    "aiKeysCard.testsSendOnlyAShort":
      "الاختبارات ترسل طلبًا تجريبيًا قصيرًا فقط، لا محادثات العملاء.",
    "aiKeysCard.apiKey": "مفتاح API",
    "aiKeysCard.open": "فتح",
    "aiKeysCard.replaceKey": "استبدال المفتاح",
    "aiKeysCard.saveKey": "حفظ المفتاح",
    "aiKeysCard.newAndReplacedKeysAre":
      "المفاتيح الجديدة والمستبدلة تُشفَّر قبل التخزين ولا تُعاد إلى متصفحك أبدًا. لتغيير مفتاح، الصق بديله هنا.",
    "aiKeysCard.onlyACompanyAdminCan":
      "مسؤول الشركة فقط يمكنه إضافة مفاتيح الذكاء الاصطناعي أو تغييرها.",
  },
  ms: {
    "aiKeysCard.couldNotTestTheProvider": "Tidak dapat menguji pembekal",
    "aiKeysCard.couldNotSaveBackupSettings": "Tidak dapat menyimpan tetapan sandaran",
    "aiKeysCard.keySavedTestTheConnection":
      "Kunci disimpan. Uji sambungan sebelum bergantung padanya.",
    "aiKeysCard.couldNotSaveTheKey": "Tidak dapat menyimpan kunci",
    "aiKeysCard.keyRemovedTheNewestRemaining":
      "Kunci dibuang. Kunci terbaharu yang tinggal, atau Flas AI terbina dalam, akan digunakan.",
    "aiKeysCard.couldNotRemoveTheKey": "Tidak dapat membuang kunci",
    "aiKeysCard.yourOwnAiKeys": "Kunci AI anda sendiri",
    "aiKeysCard.addOpenaiClaudeOrGemini":
      "Tambah OpenAI, Claude atau Gemini. Pembekal aktif yang paling baru disimpan dicuba dahulu. Kunci yang disimpan bukan ujian sambungan. Pengebilan dan had pembekal masih terpakai.",
    "aiKeysCard.savedNotAHealthCheck": "disimpan · bukan semakan kesihatan",
    "aiKeysCard.addedKeyHiddenForSafety":
      "Ditambah {toLocaleDateString} · kunci disembunyikan untuk keselamatan",
    "aiKeysCard.checked": "{message} Disemak {toLocaleTimeString}.",
    "aiKeysCard.testConnection": "Uji sambungan",
    "aiKeysCard.remove": "Buang",
    "aiKeysCard.useBackupAiWhenThe": "Gunakan AI sandaran apabila pembekal utama gagal",
    "aiKeysCard.withBackupsEnabledTheSame":
      "Dengan sandaran didayakan, gesaan dan konteks perniagaan yang sama mungkin dihantar kepada pembekal tersimpan anda yang lain, terbaharu dahulu, kemudian Flas AI terbina dalam. Caj penggunaan mereka terpakai. Had ruang kerja masih terpakai, dan penolakan keselamatan tidak sekali-kali dicuba semula dengan pembekal lain.",
    "aiKeysCard.backupSettingsNeedTheAi":
      "Tetapan sandaran memerlukan migrasi pangkalan data AI. Minta pentadbir platform anda menyelesaikan persediaan.",
    "aiKeysCard.testBuiltInAi": "Uji AI terbina dalam",
    "aiKeysCard.testsSendOnlyAShort":
      "Ujian hanya menghantar gesaan ujian pendek, bukan perbualan pelanggan.",
    "aiKeysCard.apiKey": "Kunci API",
    "aiKeysCard.open": "Buka",
    "aiKeysCard.replaceKey": "Ganti kunci",
    "aiKeysCard.saveKey": "Simpan kunci",
    "aiKeysCard.newAndReplacedKeysAre":
      "Kunci baharu dan yang diganti disulitkan sebelum disimpan dan tidak dikembalikan ke pelayar anda. Untuk menukar kunci, tampal penggantinya di sini.",
    "aiKeysCard.onlyACompanyAdminCan":
      "Hanya pentadbir syarikat boleh menambah atau menukar kunci AI.",
  },
  fil: {
    "aiKeysCard.couldNotTestTheProvider": "Hindi masubok ang provider",
    "aiKeysCard.couldNotSaveBackupSettings": "Hindi ma-save ang mga setting ng backup",
    "aiKeysCard.keySavedTestTheConnection":
      "Na-save ang key. Subukan ang koneksyon bago ito asahan.",
    "aiKeysCard.couldNotSaveTheKey": "Hindi ma-save ang key",
    "aiKeysCard.keyRemovedTheNewestRemaining":
      "Inalis ang key. Gagamitin ang pinakabagong natitirang key, o ang built-in na Flas AI.",
    "aiKeysCard.couldNotRemoveTheKey": "Hindi maalis ang key",
    "aiKeysCard.yourOwnAiKeys": "Sarili mong mga AI key",
    "aiKeysCard.addOpenaiClaudeOrGemini":
      "Idagdag ang OpenAI, Claude o Gemini. Unang sinusubukan ang pinakahuling na-save na aktibong provider. Hindi connection test ang naka-save na key. May bisa pa rin ang billing at mga limitasyon ng provider.",
    "aiKeysCard.savedNotAHealthCheck": "naka-save · hindi health check",
    "aiKeysCard.addedKeyHiddenForSafety":
      "Naidagdag {toLocaleDateString} · nakatago ang key para sa kaligtasan",
    "aiKeysCard.checked": "{message} Sinuri {toLocaleTimeString}.",
    "aiKeysCard.testConnection": "Subukan ang koneksyon",
    "aiKeysCard.remove": "Alisin",
    "aiKeysCard.useBackupAiWhenThe":
      "Gumamit ng backup na AI kapag pumalya ang pangunahing provider",
    "aiKeysCard.withBackupsEnabledTheSame":
      "Kapag naka-enable ang backup, maaaring mapunta ang parehong prompt at konteksto ng negosyo sa iba mo pang naka-save na provider, pinakabago muna, saka sa built-in na Flas AI. May bisa ang kanilang singil sa paggamit. May bisa pa rin ang mga limitasyon ng workspace, at hindi kailanman sinusubukang muli sa ibang provider ang mga pagtangging pangkaligtasan.",
    "aiKeysCard.backupSettingsNeedTheAi":
      "Kailangan ng mga setting ng backup ang AI database migration. Hilingin sa iyong platform admin na tapusin ang setup.",
    "aiKeysCard.testBuiltInAi": "Subukan ang built-in na AI",
    "aiKeysCard.testsSendOnlyAShort":
      "Maikling test prompt lang ang ipinapadala ng mga test, hindi mga usapan ng customer.",
    "aiKeysCard.apiKey": "API key",
    "aiKeysCard.open": "Buksan",
    "aiKeysCard.replaceKey": "Palitan ang key",
    "aiKeysCard.saveKey": "I-save ang key",
    "aiKeysCard.newAndReplacedKeysAre":
      "Ine-encrypt ang mga bago at pinalitang key bago iimbak at hindi ibinabalik sa iyong browser. Para palitan ang key, i-paste dito ang kapalit.",
    "aiKeysCard.onlyACompanyAdminCan":
      "Company admin lang ang makakapagdagdag o makakapagpalit ng mga AI key.",
  },
  sw: {
    "aiKeysCard.couldNotTestTheProvider": "Imeshindwa kumjaribu mtoa huduma",
    "aiKeysCard.couldNotSaveBackupSettings": "Imeshindwa kuhifadhi mipangilio ya akiba",
    "aiKeysCard.keySavedTestTheConnection":
      "Ufunguo umehifadhiwa. Jaribu muunganisho kabla ya kuutegemea.",
    "aiKeysCard.couldNotSaveTheKey": "Imeshindwa kuhifadhi ufunguo",
    "aiKeysCard.keyRemovedTheNewestRemaining":
      "Ufunguo umeondolewa. Ufunguo mpya zaidi uliobaki, au Flas AI iliyojengewa ndani, utatumika.",
    "aiKeysCard.couldNotRemoveTheKey": "Imeshindwa kuondoa ufunguo",
    "aiKeysCard.yourOwnAiKeys": "Funguo zako mwenyewe za AI",
    "aiKeysCard.addOpenaiClaudeOrGemini":
      "Ongeza OpenAI, Claude au Gemini. Mtoa huduma hai aliyehifadhiwa hivi karibuni zaidi hujaribiwa kwanza. Ufunguo uliohifadhiwa si jaribio la muunganisho. Malipo na vikomo vya mtoa huduma bado vinatumika.",
    "aiKeysCard.savedNotAHealthCheck": "umehifadhiwa · si ukaguzi wa hali",
    "aiKeysCard.addedKeyHiddenForSafety":
      "Umeongezwa {toLocaleDateString} · ufunguo umefichwa kwa usalama",
    "aiKeysCard.checked": "{message} Imekaguliwa {toLocaleTimeString}.",
    "aiKeysCard.testConnection": "Jaribu muunganisho",
    "aiKeysCard.remove": "Ondoa",
    "aiKeysCard.useBackupAiWhenThe": "Tumia AI ya akiba mtoa huduma mkuu anaposhindwa",
    "aiKeysCard.withBackupsEnabledTheSame":
      "Akiba ikiwashwa, agizo lilelile na muktadha wa biashara vinaweza kwenda kwa watoa huduma wako wengine waliohifadhiwa, wapya kwanza, kisha Flas AI iliyojengewa ndani. Gharama zao za matumizi zinatumika. Vikomo vya eneo la kazi bado vinatumika, na makataa ya usalama hayajaribiwi tena kwa mtoa huduma mwingine kamwe.",
    "aiKeysCard.backupSettingsNeedTheAi":
      "Mipangilio ya akiba inahitaji uhamishaji wa hifadhidata ya AI. Mwombe msimamizi wako wa jukwaa akamilishe usanidi.",
    "aiKeysCard.testBuiltInAi": "Jaribu AI iliyojengewa ndani",
    "aiKeysCard.testsSendOnlyAShort":
      "Majaribio hutuma agizo fupi la jaribio pekee, si mazungumzo ya wateja.",
    "aiKeysCard.apiKey": "Ufunguo wa API",
    "aiKeysCard.open": "Fungua",
    "aiKeysCard.replaceKey": "Badilisha ufunguo",
    "aiKeysCard.saveKey": "Hifadhi ufunguo",
    "aiKeysCard.newAndReplacedKeysAre":
      "Funguo mpya na zilizobadilishwa husimbwa kabla ya kuhifadhiwa na hazirudishwi kwenye kivinjari chako kamwe. Ili kubadilisha ufunguo, bandika mbadala wake hapa.",
    "aiKeysCard.onlyACompanyAdminCan":
      "Msimamizi wa kampuni pekee ndiye anaweza kuongeza au kubadilisha funguo za AI.",
  },
});
