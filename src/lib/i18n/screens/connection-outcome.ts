// Text for the "connectionOutcome" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "connectionOutcome.signInToWasCancelled": "Sign-in to {name} was cancelled",
    "connectionOutcome.signInStoppedBeforeFlas":
      "Sign-in stopped before FLAS got access, so nothing was connected or changed. You can try again whenever you are ready.",
    "connectionOutcome.tryAgain": "Try again",
    "connectionOutcome.dismiss": "Dismiss",
    "connectionOutcome.couldnTFinishConnecting": "Couldn't finish connecting {value}",
    "connectionOutcome.thePlatformDidNotReturn":
      "The platform did not return a usable authorization.",
    "connectionOutcome.nothingWasSavedSoThere":
      "Nothing was saved, so there is no half-connected account to clean up. Fix the cause above and press Connect again.",
    "connectionOutcome.loadingYourConnection": "Loading your connection",
    "connectionOutcome.refreshIfTheAccountDoes":
      "Refresh if the account does not appear, or start sign-in again.",
    "connectionOutcome.connectedFlasIsNowPinned": "Connected — Flas is now pinned to that account.",
    "connectionOutcome.couldNotCompleteTheConnection":
      "Could not complete the connection. Please try again or ask a FLAS administrator.",
    "connectionOutcome.chooseWhichAccountFlasShould": "Choose which account Flas should manage",
    "connectionOutcome.chooseTheAccountThisWorkspace":
      "Choose the account this workspace should use.",
    "connectionOutcome.askingThePlatformWhatThis": "Asking the platform what this login can reach…",
    "connectionOutcome.couldnTListTheAvailable": "Couldn't list the available accounts",
    "connectionOutcome.couldNotLoadYourAccounts":
      "Could not load your accounts. Try again or ask a FLAS administrator.",
    "connectionOutcome.openThePageWhereThis": "Open the page where this is fixed",
    "connectionOutcome.page": "Page",
    "connectionOutcome.followers": " · {toLocaleString} followers",
    "connectionOutcome.canPost": "Can post",
    "connectionOutcome.readOnly": "Read only",
    "connectionOutcome.thisLoginDoesNotControl":
      "This login does not control any account Flas can manage.",
    "connectionOutcome.useThisAccount": "Use this account",
    "connectionOutcome.later": "Later",
    "connectionOutcome.connectedTo": "Connected to {value}",
    "connectionOutcome.yourAccountIsConnectedAvailable":
      "Your account is connected. Available features depend on the access your provider approved.",
    "connectionOutcome.checkAgain": "Check again",
    "connectionOutcome.checkWhatWorks": "Check what works",
    "connectionOutcome.done": "Done",
    "connectionOutcome.connectedFlasIsNowPinned2": "Connected — Flas is now pinned to that {noun}.",
    "connectionOutcome.chooseWhichFlasShouldManage": "Choose which {noun} Flas should manage",
    "connectionOutcome.chooseTheAccountThisWorkspace2":
      "Choose the account this workspace should use. To add another later, connect again and choose it.",
    "connectionOutcome.askingThePlatformWhatThis2":
      "Asking the platform what this login can manage…",
    "connectionOutcome.thePlatformDidNotList": "The platform did not list any accounts",
    "connectionOutcome.thisLoginDoesNotManage":
      "This login does not manage any {noun} Flas can connect.",
    "connectionOutcome.useThis": "Use this",
    "connectionOutcome.noun.account": "account",
    "connectionOutcome.noun.youtube": "YouTube channel",
    "connectionOutcome.noun.linkedin": "Company Page",
    "connectionOutcome.noun.google_business": "location",
    "connectionOutcome.noun.google_analytics": "GA4 property",
    "connectionOutcome.noun.search_console": "Search Console site",
    "connectionOutcome.noun.meta_ads": "ad account",
  },
  ar: {
    "connectionOutcome.signInToWasCancelled": "أُلغي تسجيل الدخول إلى {name}",
    "connectionOutcome.signInStoppedBeforeFlas":
      "توقف تسجيل الدخول قبل أن يحصل FLAS على الوصول، فلم يُربط أو يتغير شيء. يمكنك المحاولة مجددًا متى كنت جاهزًا.",
    "connectionOutcome.tryAgain": "حاول مجددًا",
    "connectionOutcome.dismiss": "تجاهل",
    "connectionOutcome.couldnTFinishConnecting": "تعذّر إكمال ربط {value}",
    "connectionOutcome.thePlatformDidNotReturn": "لم تُرجع المنصة تفويضًا صالحًا للاستخدام.",
    "connectionOutcome.nothingWasSavedSoThere":
      "لم يُحفظ شيء، فلا يوجد حساب نصف مربوط يحتاج تنظيفًا. أصلح السبب أعلاه واضغط «ربط» مجددًا.",
    "connectionOutcome.loadingYourConnection": "جارٍ تحميل اتصالك",
    "connectionOutcome.refreshIfTheAccountDoes":
      "حدّث الصفحة إن لم يظهر الحساب، أو ابدأ تسجيل الدخول من جديد.",
    "connectionOutcome.connectedFlasIsNowPinned": "تم الربط — Flas مثبَّت الآن على ذلك الحساب.",
    "connectionOutcome.couldNotCompleteTheConnection":
      "تعذّر إتمام الاتصال. حاول مجددًا أو اسأل مسؤول FLAS.",
    "connectionOutcome.chooseWhichAccountFlasShould": "اختر الحساب الذي يديره Flas",
    "connectionOutcome.chooseTheAccountThisWorkspace": "اختر الحساب الذي تستخدمه مساحة العمل هذه.",
    "connectionOutcome.askingThePlatformWhatThis": "جارٍ سؤال المنصة عمّا يصل إليه هذا الدخول…",
    "connectionOutcome.couldnTListTheAvailable": "تعذّر عرض الحسابات المتاحة",
    "connectionOutcome.couldNotLoadYourAccounts":
      "تعذّر تحميل حساباتك. حاول مجددًا أو اسأل مسؤول FLAS.",
    "connectionOutcome.openThePageWhereThis": "افتح الصفحة التي يُصلَح فيها هذا",
    "connectionOutcome.page": "صفحة",
    "connectionOutcome.followers": " · {toLocaleString} متابع",
    "connectionOutcome.canPost": "يمكنه النشر",
    "connectionOutcome.readOnly": "قراءة فقط",
    "connectionOutcome.thisLoginDoesNotControl":
      "هذا الدخول لا يتحكم في أي حساب يستطيع Flas إدارته.",
    "connectionOutcome.useThisAccount": "استخدم هذا الحساب",
    "connectionOutcome.later": "لاحقًا",
    "connectionOutcome.connectedTo": "متصل بـ {value}",
    "connectionOutcome.yourAccountIsConnectedAvailable":
      "حسابك متصل. الميزات المتاحة تعتمد على الوصول الذي اعتمده مزوّدك.",
    "connectionOutcome.checkAgain": "افحص مجددًا",
    "connectionOutcome.checkWhatWorks": "افحص ما يعمل",
    "connectionOutcome.done": "تم",
    "connectionOutcome.connectedFlasIsNowPinned2": "تم الربط — Flas مثبَّت الآن على: {noun}.",
    "connectionOutcome.chooseWhichFlasShouldManage": "اختر ما يديره Flas: {noun}",
    "connectionOutcome.chooseTheAccountThisWorkspace2":
      "اختر الحساب الذي تستخدمه مساحة العمل هذه. لإضافة حساب آخر لاحقًا، اربط مجددًا واختره.",
    "connectionOutcome.askingThePlatformWhatThis2": "جارٍ سؤال المنصة عمّا يديره هذا الدخول…",
    "connectionOutcome.thePlatformDidNotList": "لم تعرض المنصة أي حسابات",
    "connectionOutcome.thisLoginDoesNotManage": "هذا الدخول لا يدير أي {noun} يستطيع Flas ربطه.",
    "connectionOutcome.useThis": "استخدم هذا",
    "connectionOutcome.noun.account": "حساب",
    "connectionOutcome.noun.youtube": "قناة YouTube",
    "connectionOutcome.noun.linkedin": "صفحة الشركة",
    "connectionOutcome.noun.google_business": "موقع النشاط",
    "connectionOutcome.noun.google_analytics": "موقع GA4",
    "connectionOutcome.noun.search_console": "موقع Search Console",
    "connectionOutcome.noun.meta_ads": "حساب إعلاني",
  },
  ms: {
    "connectionOutcome.signInToWasCancelled": "Log masuk ke {name} dibatalkan",
    "connectionOutcome.signInStoppedBeforeFlas":
      "Log masuk terhenti sebelum FLAS mendapat akses, jadi tiada apa-apa disambung atau diubah. Anda boleh mencuba lagi bila-bila masa anda bersedia.",
    "connectionOutcome.tryAgain": "Cuba lagi",
    "connectionOutcome.dismiss": "Tutup",
    "connectionOutcome.couldnTFinishConnecting": "Tidak dapat menyelesaikan sambungan {value}",
    "connectionOutcome.thePlatformDidNotReturn":
      "Platform tidak mengembalikan kebenaran yang boleh digunakan.",
    "connectionOutcome.nothingWasSavedSoThere":
      "Tiada apa-apa disimpan, jadi tiada akaun separuh bersambung untuk dibersihkan. Baiki punca di atas dan tekan Sambung sekali lagi.",
    "connectionOutcome.loadingYourConnection": "Memuatkan sambungan anda",
    "connectionOutcome.refreshIfTheAccountDoes":
      "Muat semula jika akaun tidak muncul, atau mulakan log masuk sekali lagi.",
    "connectionOutcome.connectedFlasIsNowPinned":
      "Disambungkan — Flas kini disematkan pada akaun itu.",
    "connectionOutcome.couldNotCompleteTheConnection":
      "Tidak dapat melengkapkan sambungan. Sila cuba lagi atau tanya pentadbir FLAS.",
    "connectionOutcome.chooseWhichAccountFlasShould": "Pilih akaun yang patut diurus Flas",
    "connectionOutcome.chooseTheAccountThisWorkspace":
      "Pilih akaun yang patut digunakan ruang kerja ini.",
    "connectionOutcome.askingThePlatformWhatThis":
      "Bertanya kepada platform apa yang boleh dicapai log masuk ini…",
    "connectionOutcome.couldnTListTheAvailable": "Tidak dapat menyenaraikan akaun yang tersedia",
    "connectionOutcome.couldNotLoadYourAccounts":
      "Tidak dapat memuatkan akaun anda. Cuba lagi atau tanya pentadbir FLAS.",
    "connectionOutcome.openThePageWhereThis": "Buka halaman tempat ini dibaiki",
    "connectionOutcome.page": "Halaman",
    "connectionOutcome.followers": " · {toLocaleString} pengikut",
    "connectionOutcome.canPost": "Boleh menyiarkan",
    "connectionOutcome.readOnly": "Baca sahaja",
    "connectionOutcome.thisLoginDoesNotControl":
      "Log masuk ini tidak mengawal mana-mana akaun yang boleh diurus Flas.",
    "connectionOutcome.useThisAccount": "Guna akaun ini",
    "connectionOutcome.later": "Kemudian",
    "connectionOutcome.connectedTo": "Disambungkan ke {value}",
    "connectionOutcome.yourAccountIsConnectedAvailable":
      "Akaun anda disambungkan. Ciri yang tersedia bergantung pada akses yang diluluskan pembekal anda.",
    "connectionOutcome.checkAgain": "Semak lagi",
    "connectionOutcome.checkWhatWorks": "Semak apa yang berfungsi",
    "connectionOutcome.done": "Selesai",
    "connectionOutcome.connectedFlasIsNowPinned2":
      "Disambungkan — Flas kini disematkan pada {noun} itu.",
    "connectionOutcome.chooseWhichFlasShouldManage": "Pilih {noun} yang patut diurus Flas",
    "connectionOutcome.chooseTheAccountThisWorkspace2":
      "Pilih akaun yang patut digunakan ruang kerja ini. Untuk menambah satu lagi kemudian, sambung sekali lagi dan pilihnya.",
    "connectionOutcome.askingThePlatformWhatThis2":
      "Bertanya kepada platform apa yang boleh diurus log masuk ini…",
    "connectionOutcome.thePlatformDidNotList": "Platform tidak menyenaraikan sebarang akaun",
    "connectionOutcome.thisLoginDoesNotManage":
      "Log masuk ini tidak mengurus mana-mana {noun} yang boleh disambung Flas.",
    "connectionOutcome.useThis": "Guna ini",
    "connectionOutcome.noun.account": "akaun",
    "connectionOutcome.noun.youtube": "saluran YouTube",
    "connectionOutcome.noun.linkedin": "Halaman Syarikat",
    "connectionOutcome.noun.google_business": "lokasi",
    "connectionOutcome.noun.google_analytics": "sifat GA4",
    "connectionOutcome.noun.search_console": "laman Search Console",
    "connectionOutcome.noun.meta_ads": "akaun iklan",
  },
  fil: {
    "connectionOutcome.signInToWasCancelled": "Kinansela ang pag-sign in sa {name}",
    "connectionOutcome.signInStoppedBeforeFlas":
      "Huminto ang sign-in bago makakuha ng access ang FLAS, kaya walang naikonekta o nabago. Maaari mong subukang muli kapag handa ka na.",
    "connectionOutcome.tryAgain": "Subukang muli",
    "connectionOutcome.dismiss": "I-dismiss",
    "connectionOutcome.couldnTFinishConnecting": "Hindi matapos ang pagkonekta ng {value}",
    "connectionOutcome.thePlatformDidNotReturn":
      "Hindi nagbalik ang platform ng magagamit na authorization.",
    "connectionOutcome.nothingWasSavedSoThere":
      "Walang na-save, kaya walang kalahating-konektadong account na kailangang linisin. Ayusin ang sanhi sa itaas at pindutin muli ang Connect.",
    "connectionOutcome.loadingYourConnection": "Nilo-load ang iyong koneksyon",
    "connectionOutcome.refreshIfTheAccountDoes":
      "Mag-refresh kung hindi lumabas ang account, o simulan muli ang sign-in.",
    "connectionOutcome.connectedFlasIsNowPinned":
      "Nakakonekta — naka-pin na ang Flas sa account na iyon.",
    "connectionOutcome.couldNotCompleteTheConnection":
      "Hindi makumpleto ang koneksyon. Subukang muli o magtanong sa FLAS administrator.",
    "connectionOutcome.chooseWhichAccountFlasShould":
      "Piliin kung aling account ang pamamahalaan ng Flas",
    "connectionOutcome.chooseTheAccountThisWorkspace":
      "Piliin ang account na gagamitin ng workspace na ito.",
    "connectionOutcome.askingThePlatformWhatThis":
      "Tinatanong ang platform kung ano ang naaabot ng login na ito…",
    "connectionOutcome.couldnTListTheAvailable": "Hindi mailista ang mga available na account",
    "connectionOutcome.couldNotLoadYourAccounts":
      "Hindi ma-load ang iyong mga account. Subukang muli o magtanong sa FLAS administrator.",
    "connectionOutcome.openThePageWhereThis": "Buksan ang page kung saan ito inaayos",
    "connectionOutcome.page": "Page",
    "connectionOutcome.followers": " · {toLocaleString} follower",
    "connectionOutcome.canPost": "Puwedeng mag-post",
    "connectionOutcome.readOnly": "Read only",
    "connectionOutcome.thisLoginDoesNotControl":
      "Walang kinokontrol na account ang login na ito na kayang pamahalaan ng Flas.",
    "connectionOutcome.useThisAccount": "Gamitin ang account na ito",
    "connectionOutcome.later": "Mamaya",
    "connectionOutcome.connectedTo": "Nakakonekta sa {value}",
    "connectionOutcome.yourAccountIsConnectedAvailable":
      "Nakakonekta ang iyong account. Nakadepende ang mga available na feature sa access na inaprubahan ng iyong provider.",
    "connectionOutcome.checkAgain": "Suriin muli",
    "connectionOutcome.checkWhatWorks": "Tingnan kung ano ang gumagana",
    "connectionOutcome.done": "Tapos",
    "connectionOutcome.connectedFlasIsNowPinned2":
      "Nakakonekta — naka-pin na ang Flas sa {noun} na iyon.",
    "connectionOutcome.chooseWhichFlasShouldManage":
      "Piliin kung aling {noun} ang pamamahalaan ng Flas",
    "connectionOutcome.chooseTheAccountThisWorkspace2":
      "Piliin ang account na gagamitin ng workspace na ito. Para magdagdag ng isa pa mamaya, kumonekta muli at piliin ito.",
    "connectionOutcome.askingThePlatformWhatThis2":
      "Tinatanong ang platform kung ano ang kayang pamahalaan ng login na ito…",
    "connectionOutcome.thePlatformDidNotList": "Walang inilistang account ang platform",
    "connectionOutcome.thisLoginDoesNotManage":
      "Walang pinamamahalaang {noun} ang login na ito na kayang ikonekta ng Flas.",
    "connectionOutcome.useThis": "Gamitin ito",
    "connectionOutcome.noun.account": "account",
    "connectionOutcome.noun.youtube": "YouTube channel",
    "connectionOutcome.noun.linkedin": "Company Page",
    "connectionOutcome.noun.google_business": "lokasyon",
    "connectionOutcome.noun.google_analytics": "GA4 property",
    "connectionOutcome.noun.search_console": "Search Console site",
    "connectionOutcome.noun.meta_ads": "ad account",
  },
  sw: {
    "connectionOutcome.signInToWasCancelled": "Kuingia kwenye {name} kumeghairiwa",
    "connectionOutcome.signInStoppedBeforeFlas":
      "Uingiaji ulisimama kabla FLAS haijapata ufikiaji, kwa hiyo hakuna kilichounganishwa au kubadilishwa. Unaweza kujaribu tena ukiwa tayari.",
    "connectionOutcome.tryAgain": "Jaribu tena",
    "connectionOutcome.dismiss": "Ondoa",
    "connectionOutcome.couldnTFinishConnecting": "Imeshindwa kukamilisha kuunganisha {value}",
    "connectionOutcome.thePlatformDidNotReturn": "Jukwaa halikurudisha idhini inayoweza kutumika.",
    "connectionOutcome.nothingWasSavedSoThere":
      "Hakuna kilichohifadhiwa, kwa hiyo hakuna akaunti iliyounganishwa nusu ya kusafisha. Rekebisha chanzo hapo juu na ubonyeze Unganisha tena.",
    "connectionOutcome.loadingYourConnection": "Inapakia muunganisho wako",
    "connectionOutcome.refreshIfTheAccountDoes":
      "Onyesha upya ikiwa akaunti haionekani, au anza kuingia tena.",
    "connectionOutcome.connectedFlasIsNowPinned":
      "Imeunganishwa — Flas sasa imebandikwa kwenye akaunti hiyo.",
    "connectionOutcome.couldNotCompleteTheConnection":
      "Imeshindwa kukamilisha muunganisho. Tafadhali jaribu tena au muulize msimamizi wa FLAS.",
    "connectionOutcome.chooseWhichAccountFlasShould":
      "Chagua akaunti ambayo Flas inapaswa kusimamia",
    "connectionOutcome.chooseTheAccountThisWorkspace":
      "Chagua akaunti ambayo eneo hili la kazi litatumia.",
    "connectionOutcome.askingThePlatformWhatThis":
      "Inauliza jukwaa uingiaji huu unaweza kufikia nini…",
    "connectionOutcome.couldnTListTheAvailable": "Imeshindwa kuorodhesha akaunti zinazopatikana",
    "connectionOutcome.couldNotLoadYourAccounts":
      "Imeshindwa kupakia akaunti zako. Jaribu tena au muulize msimamizi wa FLAS.",
    "connectionOutcome.openThePageWhereThis": "Fungua ukurasa ambapo hili hurekebishwa",
    "connectionOutcome.page": "Ukurasa",
    "connectionOutcome.followers": " · wafuasi {toLocaleString}",
    "connectionOutcome.canPost": "Inaweza kuchapisha",
    "connectionOutcome.readOnly": "Kusoma tu",
    "connectionOutcome.thisLoginDoesNotControl":
      "Uingiaji huu haudhibiti akaunti yoyote ambayo Flas inaweza kusimamia.",
    "connectionOutcome.useThisAccount": "Tumia akaunti hii",
    "connectionOutcome.later": "Baadaye",
    "connectionOutcome.connectedTo": "Imeunganishwa na {value}",
    "connectionOutcome.yourAccountIsConnectedAvailable":
      "Akaunti yako imeunganishwa. Vipengele vinavyopatikana hutegemea ufikiaji ulioidhinishwa na mtoa huduma wako.",
    "connectionOutcome.checkAgain": "Kagua tena",
    "connectionOutcome.checkWhatWorks": "Kagua kinachofanya kazi",
    "connectionOutcome.done": "Imekamilika",
    "connectionOutcome.connectedFlasIsNowPinned2":
      "Imeunganishwa — Flas sasa imebandikwa kwenye {noun} hiyo.",
    "connectionOutcome.chooseWhichFlasShouldManage": "Chagua {noun} ambayo Flas inapaswa kusimamia",
    "connectionOutcome.chooseTheAccountThisWorkspace2":
      "Chagua akaunti ambayo eneo hili la kazi litatumia. Ili kuongeza nyingine baadaye, unganisha tena na uichague.",
    "connectionOutcome.askingThePlatformWhatThis2":
      "Inauliza jukwaa uingiaji huu unaweza kusimamia nini…",
    "connectionOutcome.thePlatformDidNotList": "Jukwaa halikuorodhesha akaunti zozote",
    "connectionOutcome.thisLoginDoesNotManage":
      "Uingiaji huu hausimamii {noun} yoyote ambayo Flas inaweza kuunganisha.",
    "connectionOutcome.useThis": "Tumia hii",
    "connectionOutcome.noun.account": "akaunti",
    "connectionOutcome.noun.youtube": "chaneli ya YouTube",
    "connectionOutcome.noun.linkedin": "Ukurasa wa Kampuni",
    "connectionOutcome.noun.google_business": "eneo",
    "connectionOutcome.noun.google_analytics": "mali ya GA4",
    "connectionOutcome.noun.search_console": "tovuti ya Search Console",
    "connectionOutcome.noun.meta_ads": "akaunti ya matangazo",
  },
});
