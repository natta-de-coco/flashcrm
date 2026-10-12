// Text for the "connectionWizard" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "connectionWizard.setupWizard": "{value} setup wizard{badge}",
    "connectionWizard.ownerAdminOneTime": "Owner/admin · one time",
    "connectionWizard.smmTeamPerClientChannel": "SMM team · per client/channel",
    "connectionWizard.getTheseInPlaceFirst":
      "Get these in place first — most failed connections are missing one of them.",
    "connectionWizard.officialSetupShortcuts": "Official setup shortcuts",
    "connectionWizard.noTreasureHuntTheseOpen":
      "No treasure hunt. These open the provider's own pages for apps, keys, permissions and review.",
    "connectionWizard.whatHappensInOrder": "What happens, in order",
    "connectionWizard.confirmed": "{doneCount}/{length} confirmed.",
    "connectionWizard.tickEachLineOnceIt": "Tick each line once it is true. {value}",
    "connectionWizard.nothingToVerifyForThis":
      "Nothing to verify for this platform — continue to permissions.",
    "connectionWizard.whereAreTheKeys": "Where are the keys?",
    "connectionWizard.openTheOfficialProviderPage":
      "Open the official provider page below. Copy only the App/Client ID and Secret requested by Flas — never paste user access tokens here.",
    "connectionWizard.permissionsFlasWillRequest": "Permissions Flas will request",
    "connectionWizard.thisPlatformIsConfiguredManually":
      "This platform is configured manually inside Flas — no OAuth permissions needed.",
    "connectionWizard.grantTheFullFlasPermission":
      "Grant the full Flas permission set shown on the provider screen",
    "connectionWizard.approveEveryPermissionFlasRequests":
      "Approve every permission Flas requests for this connector. Do not grant unrelated permissions that Flas did not request. If the provider lets you decline individual scopes, Flas will verify the result and mark only the affected capability unavailable instead of pretending the connection is healthy.",
    "connectionWizard.profileAccess": "profile access",
    "connectionWizard.thesePermissionsPower": "These permissions power: {value}.",
    "connectionWizard.expectedReviewTimeline": "Expected review timeline",
    "connectionWizard.redirectUriToWhitelistIn":
      "Redirect URI to whitelist in your provider app: {span}",
    "connectionWizard.flasOpensThePlatformS":
      "Flas opens the platform's official login in a new browser tab. Your password stays with the provider; Flas receives only the OAuth authorization result.",
    "connectionWizard.pressConnectBelowAndSign":
      "Press Connect below and sign in on the provider's own page.",
    "connectionWizard.approveEveryPermissionFlasShows":
      "Approve every permission Flas shows. If you manage several assets, choose the right client Page/channel/account.",
    "connectionWizard.returnToFlasTheConnection":
      "Return to Flas. The connection is verified before it is shown as healthy.",
    "connectionWizard.ifSomethingIsMissingFlas":
      "If something is missing, Flas should name the exact scope/review/account-type blocker — not the timeless classic “Something went wrong.”",
    "connectionWizard.opening": "Opening…",
    "connectionWizard.connectSecurely": "Connect securely",
    "connectionWizard.platformSettings": "Platform settings",
    "connectionWizard.currentStatus": "Current status",
    "connectionWizard.noKnownPlatformErrorsRecorded": "No known platform errors recorded yet.",
    "connectionWizard.fix": "Fix: {fix}",
    "connectionWizard.platformLimitsWorthKnowing": "Platform limits worth knowing",
    "connectionWizard.back": "Back",
    "connectionWizard.nextStep": "Next step",
    "connectionWizard.step.prepare": "Prepare the account",
    "connectionWizard.step.verify": "Verify you're ready",
    "connectionWizard.step.credentials": "Enter your keys",
    "connectionWizard.step.permissions": "Permissions & review",
    "connectionWizard.step.connect": "Connect securely",
    "connectionWizard.step.errors": "Common errors & quick fixes",
  },
  ar: {
    "connectionWizard.setupWizard": "معالج إعداد {value}{badge}",
    "connectionWizard.ownerAdminOneTime": "المالك/المسؤول · مرة واحدة",
    "connectionWizard.smmTeamPerClientChannel": "فريق التواصل الاجتماعي · لكل عميل/قناة",
    "connectionWizard.getTheseInPlaceFirst":
      "جهّز هذه أولًا — معظم الاتصالات الفاشلة ينقصها واحد منها.",
    "connectionWizard.officialSetupShortcuts": "اختصارات الإعداد الرسمية",
    "connectionWizard.noTreasureHuntTheseOpen":
      "لا حاجة للبحث. هذه تفتح صفحات المزوّد نفسه للتطبيقات والمفاتيح والصلاحيات والمراجعة.",
    "connectionWizard.whatHappensInOrder": "ما سيحدث، بالترتيب",
    "connectionWizard.confirmed": "تم تأكيد {doneCount}/{length}.",
    "connectionWizard.tickEachLineOnceIt": "ضع علامة على كل بند حين يتحقق. {value}",
    "connectionWizard.nothingToVerifyForThis":
      "لا شيء للتحقق منه في هذه المنصة — تابع إلى الصلاحيات.",
    "connectionWizard.whereAreTheKeys": "أين المفاتيح؟",
    "connectionWizard.openTheOfficialProviderPage":
      "افتح صفحة المزوّد الرسمية أدناه. انسخ فقط معرّف التطبيق/العميل والسر اللذين يطلبهما Flas — ولا تلصق رموز وصول المستخدمين هنا أبدًا.",
    "connectionWizard.permissionsFlasWillRequest": "الصلاحيات التي سيطلبها Flas",
    "connectionWizard.thisPlatformIsConfiguredManually":
      "هذه المنصة تُهيأ يدويًا داخل Flas — لا حاجة لصلاحيات OAuth.",
    "connectionWizard.grantTheFullFlasPermission":
      "امنح مجموعة صلاحيات Flas الكاملة المعروضة على شاشة المزوّد",
    "connectionWizard.approveEveryPermissionFlasRequests":
      "وافق على كل صلاحية يطلبها Flas لهذا الموصل. لا تمنح صلاحيات غير ذات صلة لم يطلبها Flas. إن أتاح لك المزوّد رفض صلاحيات بعينها، سيتحقق Flas من النتيجة ويعلّم القدرة المتأثرة فقط كغير متاحة بدل الادعاء بأن الاتصال سليم.",
    "connectionWizard.profileAccess": "الوصول إلى الملف الشخصي",
    "connectionWizard.thesePermissionsPower": "هذه الصلاحيات تشغّل: {value}.",
    "connectionWizard.expectedReviewTimeline": "المدة المتوقعة للمراجعة",
    "connectionWizard.redirectUriToWhitelistIn":
      "عنوان إعادة التوجيه المطلوب السماح به في تطبيق المزوّد: {span}",
    "connectionWizard.flasOpensThePlatformS":
      "يفتح Flas تسجيل الدخول الرسمي للمنصة في علامة تبويب جديدة. كلمة مرورك تبقى لدى المزوّد؛ ويستلم Flas نتيجة تفويض OAuth فقط.",
    "connectionWizard.pressConnectBelowAndSign":
      "اضغط «ربط» أدناه وسجّل الدخول في صفحة المزوّد نفسه.",
    "connectionWizard.approveEveryPermissionFlasShows":
      "وافق على كل صلاحية يعرضها Flas. إن كنت تدير عدة أصول، فاختر صفحة/قناة/حساب العميل الصحيح.",
    "connectionWizard.returnToFlasTheConnection": "عُد إلى Flas. يُتحقق من الاتصال قبل عرضه كسليم.",
    "connectionWizard.ifSomethingIsMissingFlas":
      "إن كان هناك شيء ناقص، فعلى Flas أن يسمّي العائق بالتحديد — صلاحية أو مراجعة أو نوع حساب — لا العبارة المعهودة «حدث خطأ ما».",
    "connectionWizard.opening": "جارٍ الفتح…",
    "connectionWizard.connectSecurely": "اربط بأمان",
    "connectionWizard.platformSettings": "إعدادات المنصة",
    "connectionWizard.currentStatus": "الحالة الحالية",
    "connectionWizard.noKnownPlatformErrorsRecorded": "لم تُسجَّل أخطاء معروفة للمنصة بعد.",
    "connectionWizard.fix": "الحل: {fix}",
    "connectionWizard.platformLimitsWorthKnowing": "قيود المنصة الجديرة بالمعرفة",
    "connectionWizard.back": "رجوع",
    "connectionWizard.nextStep": "الخطوة التالية",
    "connectionWizard.step.prepare": "تجهيز الحساب",
    "connectionWizard.step.verify": "تأكد من جاهزيتك",
    "connectionWizard.step.credentials": "أدخل مفاتيحك",
    "connectionWizard.step.permissions": "الصلاحيات والمراجعة",
    "connectionWizard.step.connect": "اربط بأمان",
    "connectionWizard.step.errors": "الأخطاء الشائعة وحلول سريعة",
  },
  ms: {
    "connectionWizard.setupWizard": "Wizard persediaan {value}{badge}",
    "connectionWizard.ownerAdminOneTime": "Pemilik/pentadbir · sekali sahaja",
    "connectionWizard.smmTeamPerClientChannel": "Pasukan SMM · bagi setiap pelanggan/saluran",
    "connectionWizard.getTheseInPlaceFirst":
      "Sediakan ini dahulu — kebanyakan sambungan yang gagal kekurangan salah satu daripadanya.",
    "connectionWizard.officialSetupShortcuts": "Pintasan persediaan rasmi",
    "connectionWizard.noTreasureHuntTheseOpen":
      "Tidak perlu mencari-cari. Ini membuka halaman pembekal sendiri untuk aplikasi, kunci, kebenaran dan semakan.",
    "connectionWizard.whatHappensInOrder": "Apa yang berlaku, mengikut urutan",
    "connectionWizard.confirmed": "{doneCount}/{length} disahkan.",
    "connectionWizard.tickEachLineOnceIt": "Tandakan setiap baris apabila ia benar. {value}",
    "connectionWizard.nothingToVerifyForThis":
      "Tiada apa-apa untuk disahkan bagi platform ini — teruskan ke kebenaran.",
    "connectionWizard.whereAreTheKeys": "Di mana kuncinya?",
    "connectionWizard.openTheOfficialProviderPage":
      "Buka halaman rasmi pembekal di bawah. Salin hanya ID Aplikasi/Klien dan Rahsia yang diminta Flas — jangan sekali-kali tampal token akses pengguna di sini.",
    "connectionWizard.permissionsFlasWillRequest": "Kebenaran yang akan diminta Flas",
    "connectionWizard.thisPlatformIsConfiguredManually":
      "Platform ini dikonfigurasi secara manual dalam Flas — tiada kebenaran OAuth diperlukan.",
    "connectionWizard.grantTheFullFlasPermission":
      "Berikan set kebenaran Flas penuh yang ditunjukkan pada skrin pembekal",
    "connectionWizard.approveEveryPermissionFlasRequests":
      "Luluskan setiap kebenaran yang diminta Flas untuk penyambung ini. Jangan berikan kebenaran tidak berkaitan yang tidak diminta Flas. Jika pembekal membenarkan anda menolak skop tertentu, Flas akan mengesahkan hasilnya dan menandakan hanya keupayaan yang terjejas sebagai tidak tersedia, bukannya berpura-pura sambungan itu sihat.",
    "connectionWizard.profileAccess": "akses profil",
    "connectionWizard.thesePermissionsPower": "Kebenaran ini menggerakkan: {value}.",
    "connectionWizard.expectedReviewTimeline": "Jangka masa semakan dijangka",
    "connectionWizard.redirectUriToWhitelistIn":
      "URI ubah hala untuk disenarai putih dalam aplikasi pembekal anda: {span}",
    "connectionWizard.flasOpensThePlatformS":
      "Flas membuka log masuk rasmi platform dalam tab pelayar baharu. Kata laluan anda kekal dengan pembekal; Flas hanya menerima hasil kebenaran OAuth.",
    "connectionWizard.pressConnectBelowAndSign":
      "Tekan Sambung di bawah dan log masuk pada halaman pembekal sendiri.",
    "connectionWizard.approveEveryPermissionFlasShows":
      "Luluskan setiap kebenaran yang ditunjukkan Flas. Jika anda mengurus beberapa aset, pilih Halaman/saluran/akaun pelanggan yang betul.",
    "connectionWizard.returnToFlasTheConnection":
      "Kembali ke Flas. Sambungan disahkan sebelum ditunjukkan sebagai sihat.",
    "connectionWizard.ifSomethingIsMissingFlas":
      "Jika ada yang kurang, Flas patut menamakan penghalang yang tepat — skop/semakan/jenis akaun — bukan ayat klasik “Sesuatu telah berlaku.”",
    "connectionWizard.opening": "Membuka…",
    "connectionWizard.connectSecurely": "Sambung dengan selamat",
    "connectionWizard.platformSettings": "Tetapan platform",
    "connectionWizard.currentStatus": "Status semasa",
    "connectionWizard.noKnownPlatformErrorsRecorded":
      "Belum ada ralat platform yang diketahui direkodkan.",
    "connectionWizard.fix": "Pembetulan: {fix}",
    "connectionWizard.platformLimitsWorthKnowing": "Had platform yang patut diketahui",
    "connectionWizard.back": "Kembali",
    "connectionWizard.nextStep": "Langkah seterusnya",
    "connectionWizard.step.prepare": "Sediakan akaun",
    "connectionWizard.step.verify": "Sahkan anda sudah sedia",
    "connectionWizard.step.credentials": "Masukkan kunci anda",
    "connectionWizard.step.permissions": "Kebenaran & semakan",
    "connectionWizard.step.connect": "Sambung dengan selamat",
    "connectionWizard.step.errors": "Ralat biasa & pembetulan pantas",
  },
  fil: {
    "connectionWizard.setupWizard": "Setup wizard ng {value}{badge}",
    "connectionWizard.ownerAdminOneTime": "Owner/admin · isang beses",
    "connectionWizard.smmTeamPerClientChannel": "SMM team · bawat kliyente/channel",
    "connectionWizard.getTheseInPlaceFirst":
      "Ihanda muna ang mga ito — karamihan ng nabibigong koneksyon ay kulang ng isa sa mga ito.",
    "connectionWizard.officialSetupShortcuts": "Mga opisyal na shortcut sa setup",
    "connectionWizard.noTreasureHuntTheseOpen":
      "Hindi na kailangang maghanap. Binubuksan ng mga ito ang sariling page ng provider para sa mga app, key, pahintulot at review.",
    "connectionWizard.whatHappensInOrder": "Ano ang mangyayari, ayon sa pagkakasunod",
    "connectionWizard.confirmed": "{doneCount}/{length} ang nakumpirma.",
    "connectionWizard.tickEachLineOnceIt": "I-tick ang bawat linya kapag totoo na ito. {value}",
    "connectionWizard.nothingToVerifyForThis":
      "Walang kailangang i-verify para sa platform na ito — magpatuloy sa mga pahintulot.",
    "connectionWizard.whereAreTheKeys": "Nasaan ang mga key?",
    "connectionWizard.openTheOfficialProviderPage":
      "Buksan ang opisyal na page ng provider sa ibaba. Kopyahin lang ang App/Client ID at Secret na hinihingi ng Flas — huwag kailanman mag-paste ng user access token dito.",
    "connectionWizard.permissionsFlasWillRequest": "Mga pahintulot na hihingin ng Flas",
    "connectionWizard.thisPlatformIsConfiguredManually":
      "Mano-manong kino-configure ang platform na ito sa loob ng Flas — hindi kailangan ng OAuth permissions.",
    "connectionWizard.grantTheFullFlasPermission":
      "Ibigay ang buong hanay ng pahintulot ng Flas na ipinapakita sa screen ng provider",
    "connectionWizard.approveEveryPermissionFlasRequests":
      "Aprubahan ang bawat pahintulot na hinihingi ng Flas para sa connector na ito. Huwag magbigay ng mga walang kaugnayang pahintulot na hindi hiningi ng Flas. Kung pinapayagan ka ng provider na tanggihan ang mga indibidwal na scope, ive-verify ng Flas ang resulta at mamarkahan lang na hindi available ang apektadong kakayahan sa halip na magkunwaring maayos ang koneksyon.",
    "connectionWizard.profileAccess": "access sa profile",
    "connectionWizard.thesePermissionsPower":
      "Ang mga pahintulot na ito ang nagpapagana sa: {value}.",
    "connectionWizard.expectedReviewTimeline": "Inaasahang tagal ng review",
    "connectionWizard.redirectUriToWhitelistIn":
      "Redirect URI na ia-allow sa iyong provider app: {span}",
    "connectionWizard.flasOpensThePlatformS":
      "Binubuksan ng Flas ang opisyal na login ng platform sa bagong tab ng browser. Nananatili sa provider ang iyong password; ang resulta lang ng OAuth authorization ang natatanggap ng Flas.",
    "connectionWizard.pressConnectBelowAndSign":
      "Pindutin ang Connect sa ibaba at mag-sign in sa sariling page ng provider.",
    "connectionWizard.approveEveryPermissionFlasShows":
      "Aprubahan ang bawat pahintulot na ipinapakita ng Flas. Kung marami kang pinamamahalaang asset, piliin ang tamang Page/channel/account ng kliyente.",
    "connectionWizard.returnToFlasTheConnection":
      "Bumalik sa Flas. Bine-verify ang koneksyon bago ito ipakitang maayos.",
    "connectionWizard.ifSomethingIsMissingFlas":
      "Kung may kulang, dapat sabihin ng Flas ang eksaktong hadlang — scope/review/uri ng account — hindi ang klasikong “May nangyaring mali.”",
    "connectionWizard.opening": "Binubuksan…",
    "connectionWizard.connectSecurely": "Kumonekta nang secure",
    "connectionWizard.platformSettings": "Mga setting ng platform",
    "connectionWizard.currentStatus": "Kasalukuyang status",
    "connectionWizard.noKnownPlatformErrorsRecorded":
      "Wala pang naitalang kilalang error sa platform.",
    "connectionWizard.fix": "Ayusin: {fix}",
    "connectionWizard.platformLimitsWorthKnowing": "Mga limitasyon ng platform na dapat malaman",
    "connectionWizard.back": "Bumalik",
    "connectionWizard.nextStep": "Susunod na hakbang",
    "connectionWizard.step.prepare": "Ihanda ang account",
    "connectionWizard.step.verify": "Tiyaking handa ka na",
    "connectionWizard.step.credentials": "Ilagay ang iyong mga key",
    "connectionWizard.step.permissions": "Mga pahintulot at review",
    "connectionWizard.step.connect": "Kumonekta nang secure",
    "connectionWizard.step.errors": "Mga karaniwang error at mabilis na lunas",
  },
  sw: {
    "connectionWizard.setupWizard": "Mwongozo wa usanidi wa {value}{badge}",
    "connectionWizard.ownerAdminOneTime": "Mmiliki/msimamizi · mara moja",
    "connectionWizard.smmTeamPerClientChannel": "Timu ya SMM · kwa kila mteja/chaneli",
    "connectionWizard.getTheseInPlaceFirst":
      "Weka haya tayari kwanza — miunganisho mingi inayoshindwa hukosa mojawapo.",
    "connectionWizard.officialSetupShortcuts": "Njia za mkato rasmi za usanidi",
    "connectionWizard.noTreasureHuntTheseOpen":
      "Hakuna kutafuta-tafuta. Hizi hufungua kurasa za mtoa huduma mwenyewe za programu, funguo, ruhusa na ukaguzi.",
    "connectionWizard.whatHappensInOrder": "Kinachotokea, kwa mpangilio",
    "connectionWizard.confirmed": "{doneCount}/{length} zimethibitishwa.",
    "connectionWizard.tickEachLineOnceIt": "Weka alama kila mstari unapokuwa kweli. {value}",
    "connectionWizard.nothingToVerifyForThis":
      "Hakuna cha kuthibitisha kwa jukwaa hili — endelea kwenye ruhusa.",
    "connectionWizard.whereAreTheKeys": "Funguo ziko wapi?",
    "connectionWizard.openTheOfficialProviderPage":
      "Fungua ukurasa rasmi wa mtoa huduma hapa chini. Nakili tu Kitambulisho cha Programu/Mteja na Siri vinavyoombwa na Flas — usibandike kamwe tokeni za ufikiaji za watumiaji hapa.",
    "connectionWizard.permissionsFlasWillRequest": "Ruhusa ambazo Flas itaomba",
    "connectionWizard.thisPlatformIsConfiguredManually":
      "Jukwaa hili husanidiwa kwa mkono ndani ya Flas — hakuna ruhusa za OAuth zinazohitajika.",
    "connectionWizard.grantTheFullFlasPermission":
      "Toa seti kamili ya ruhusa za Flas inayoonyeshwa kwenye skrini ya mtoa huduma",
    "connectionWizard.approveEveryPermissionFlasRequests":
      "Idhinisha kila ruhusa ambayo Flas inaomba kwa kiunganishi hiki. Usitoe ruhusa zisizohusiana ambazo Flas haikuomba. Ikiwa mtoa huduma anakuruhusu kukataa ruhusa mojamoja, Flas itathibitisha matokeo na kuweka alama ya kutopatikana kwa uwezo ulioathirika pekee badala ya kujifanya muunganisho uko sawa.",
    "connectionWizard.profileAccess": "ufikiaji wa wasifu",
    "connectionWizard.thesePermissionsPower": "Ruhusa hizi huwezesha: {value}.",
    "connectionWizard.expectedReviewTimeline": "Muda unaotarajiwa wa ukaguzi",
    "connectionWizard.redirectUriToWhitelistIn":
      "URI ya kuelekeza upya ya kuruhusu katika programu yako ya mtoa huduma: {span}",
    "connectionWizard.flasOpensThePlatformS":
      "Flas hufungua uingiaji rasmi wa jukwaa katika kichupo kipya cha kivinjari. Nenosiri lako hubaki kwa mtoa huduma; Flas hupokea tu matokeo ya idhini ya OAuth.",
    "connectionWizard.pressConnectBelowAndSign":
      "Bonyeza Unganisha hapa chini na uingie kwenye ukurasa wa mtoa huduma mwenyewe.",
    "connectionWizard.approveEveryPermissionFlasShows":
      "Idhinisha kila ruhusa ambayo Flas inaonyesha. Ikiwa unasimamia mali kadhaa, chagua Ukurasa/chaneli/akaunti sahihi ya mteja.",
    "connectionWizard.returnToFlasTheConnection":
      "Rudi Flas. Muunganisho huthibitishwa kabla ya kuonyeshwa kuwa uko sawa.",
    "connectionWizard.ifSomethingIsMissingFlas":
      "Ikiwa kuna kinachokosekana, Flas inapaswa kutaja kikwazo hasa — ruhusa/ukaguzi/aina ya akaunti — si ile kauli ya kawaida “Kuna hitilafu imetokea.”",
    "connectionWizard.opening": "Inafungua…",
    "connectionWizard.connectSecurely": "Unganisha kwa usalama",
    "connectionWizard.platformSettings": "Mipangilio ya jukwaa",
    "connectionWizard.currentStatus": "Hali ya sasa",
    "connectionWizard.noKnownPlatformErrorsRecorded":
      "Bado hakuna hitilafu zinazojulikana za jukwaa zilizorekodiwa.",
    "connectionWizard.fix": "Suluhisho: {fix}",
    "connectionWizard.platformLimitsWorthKnowing": "Mipaka ya jukwaa inayofaa kujulikana",
    "connectionWizard.back": "Rudi",
    "connectionWizard.nextStep": "Hatua inayofuata",
    "connectionWizard.step.prepare": "Andaa akaunti",
    "connectionWizard.step.verify": "Thibitisha uko tayari",
    "connectionWizard.step.credentials": "Weka funguo zako",
    "connectionWizard.step.permissions": "Ruhusa na ukaguzi",
    "connectionWizard.step.connect": "Unganisha kwa usalama",
    "connectionWizard.step.errors": "Hitilafu za kawaida na suluhisho za haraka",
  },
});
