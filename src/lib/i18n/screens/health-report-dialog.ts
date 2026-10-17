// Text for the "healthReportDialog" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "healthReportDialog.encryptedStoredCredentialS": "Encrypted {sealedNow} stored credential(s).",
    "healthReportDialog.nothingNeededEncrypting": "Nothing needed encrypting.",
    "healthReportDialog.healthReport": "Health report",
    "healthReportDialog.integrationHealthReport": "Integration Health Report",
    "healthReportDialog.statusLastErrorMissingPermissions":
      "Status, last error, missing permissions and the next retry step for the {oauthPlatforms} API platform connectors that sign in with OAuth. The other {keyedOrPlugin} — {join} — connect with keys or a plugin rather than a login, so they are checked on their own cards instead. Export this and share it with whoever owns the account.",
    "healthReportDialog.connected": "{connected} connected",
    "healthReportDialog.needAttention": "{needsattention} need attention",
    "healthReportDialog.notConnected": "{notconnected} not connected",
    "healthReportDialog.encrypting": "Encrypting…",
    "healthReportDialog.encryptNow": "Encrypt now",
    "healthReportDialog.lastError": "Last error: {lasterror}",
    "healthReportDialog.missingPermissions": "Missing permissions: {join}",
    "healthReportDialog.nextStep": "Next step:",
    "healthReportDialog.retryNow": "Retry now",
    "healthReportDialog.reasonNotVerified":
      "Authorized, but Flas has not yet confirmed with {Platform} that the token works.",
    "healthReportDialog.fixNotVerified":
      "Press Verify now. Flas checks with {Platform} and saves the result.",
    "healthReportDialog.reasonEvidenceUnavailable":
      "Flas cannot save verification results for this workspace yet, so this account cannot be marked verified.",
    "healthReportDialog.fixEvidenceUnavailable":
      "Ask Flas support to finish the database update, then press Verify now.",
    "healthReportDialog.reasonScopesUnknown":
      "{Platform} accepts the token but did not list its permissions, so Flas cannot confirm them.",
    "healthReportDialog.fixKeepPermissions": "Reconnect and keep every permission switched on.",
    "healthReportDialog.reasonScopesMissing":
      "Connected, but {Platform} did not grant what these features need: {features}. They stay switched off.",
    "healthReportDialog.reasonConnected":
      "Verified {verified}. {Platform} accepted the token and every permission Flas needs was granted. Last synced {synced}.",
    "healthReportDialog.connectedNotProven":
      "This check does not prove that {features} works. That depends on {Platform}'s app review.",
    "healthReportDialog.reasonVerifiedNotSynced":
      "Verified {verified}, but the first sync has not finished.",
    "healthReportDialog.fixVerifiedNotSynced":
      "Press Sync now. If it stays empty, the platform app may still be in review or development mode.",
    "healthReportDialog.reasonDisconnected":
      "Someone in this workspace disconnected this account on purpose.",
    "healthReportDialog.fixDisconnected": "Connect it again whenever you need it.",
    "healthReportDialog.labelDisconnected": "Disconnected",
    "healthReportDialog.labelProviderUnavailable": "Platform unavailable",
    "healthReportDialog.labelUnverified": "Not yet verified",
    "healthReportDialog.reasonProviderUnavailable":
      "{Platform} is not answering or is limiting requests. Your connection has not been changed.",
    "healthReportDialog.fixProviderUnavailable": "Nothing to do now. Press Retry now after {time}.",
    "healthReportDialog.fixProviderUnavailableSoon":
      "Nothing to do now. Press Retry now in a few minutes.",
    "healthReportDialog.reasonUnidentified":
      "This sign-in is saved, but no account was chosen yet.",
    "healthReportDialog.fixUnidentified": "Choose which account to connect.",
    "healthReportDialog.outcomeVerified":
      "Verified. {Platform} accepted the token and Flas saved the result.",
    "healthReportDialog.outcomeScopesMissing":
      "The token works, but {Platform} did not grant: {permissions}. Reconnect and keep every permission switched on.",
    "healthReportDialog.outcomeUnavailableStatus":
      "{Platform} did not answer (HTTP {status}). Nothing was changed and the account was not marked verified. Try again after {time}.",
    "healthReportDialog.outcomeUnavailable":
      "{Platform} did not answer. Nothing was changed and the account was not marked verified. Try again after {time}.",
    "healthReportDialog.outcomeRateLimited":
      "{Platform} is limiting requests right now. Nothing was changed. Try again in a few minutes.",
    "healthReportDialog.outcomeNeedsReconnect":
      "{Platform} no longer accepts this token. Reconnect the account.",
    "healthReportDialog.outcomeForbidden":
      "{Platform} refused the check (HTTP 403). A permission is probably missing. Reconnect and keep every permission switched on.",
    "healthReportDialog.outcomeNotCheckable":
      "Flas has no live check for {Platform} yet, so it cannot verify this account.",
    "healthReportDialog.outcomeSaveFailed":
      "The check ran, but Flas could not save the result, so nothing was marked verified. Reference {id}.",
    "healthReportDialog.outcomeEvidenceUnavailable":
      "{Platform} accepted the token, but this workspace cannot store verification results yet. Reference {id}.",
    "healthReportDialog.outcomeSkippedDisconnected":
      "This account was disconnected on purpose. Connect it again to use it.",
    "healthReportDialog.outcomeInProgress":
      "Another check for this account is already running. Try again in a minute.",
    "healthReportDialog.outcomeRecentlyChecked": "Checked a moment ago. Showing the saved result.",
    "healthReportDialog.outcomeReconnectNeeded":
      "This account was added with a pasted token. Reconnect it so Flas can verify it.",
    "healthReportDialog.outcomeFailed":
      "The check could not finish, so nothing was changed. Reference {id}.",
    "healthReportDialog.outcomeNotFound": "That account was not found in this workspace.",
    "healthReportDialog.onlyCompanyAdmin": "Only a company admin can check connections.",
    "healthReportDialog.checkedSummary":
      "Checked {n} account(s): {verified} verified, {attention} need attention, {skipped} not checked.",
    "healthReportDialog.nothingNeededCheck": "Nothing needed a check right now.",
    "healthReportDialog.verifyNow": "Verify now",
    "healthReportDialog.reconnect": "Reconnect",
    "healthReportDialog.chooseAccount": "Choose account",
    "healthReportDialog.continueWith": "Continue with {Platform}",
    "healthReportDialog.comingSoon": "Coming soon",
    "healthReportDialog.checkAttention": "Check what is due",
    "healthReportDialog.recentChecks": "Recent checks",
    "healthReportDialog.diagReference": "Reference {id}",
    "healthReportDialog.diagStage": "Stage: {stage}",
    "healthReportDialog.diagStatus": "Provider status: {status}",
    "healthReportDialog.diagLastCheck": "Last check: {time}",
    "healthReportDialog.diagStorageReady": "Verification storage: ready",
    "healthReportDialog.diagStorageMissing": "Verification storage: not available",
    "healthReportDialog.diagScopes": "Permissions not granted: {scopes}",
    "healthReportDialog.diagMessage": "Platform said: {message}",
    "healthReportDialog.outcomeChanged":
      "This account changed while Flas was checking it, so the result was not saved and nothing was marked verified.",
    "healthReportDialog.reasonRefreshFailed":
      "The platform did not accept the stored sign-in the last time Flas checked it.",
    "healthReportDialog.fixReconnect": "Reconnect the account.",
    "healthReportDialog.reasonEvidenceUnreadable":
      "Flas could not read this account's saved check results just now, so it cannot say whether the account is verified.",
    "healthReportDialog.fixEvidenceUnreadable":
      "Try again in a moment. If it keeps happening, tell Flas support.",
    "healthReportDialog.whatsappElsewhere": "WhatsApp is checked on the Alerts & health page.",
    "healthReportDialog.outcomeWaiting":
      "Flas is waiting before it asks {Platform} again. Try again after {time}.",
    "healthReportDialog.diagStorageUnreadable": "Verification storage: could not be read",
    "healthReportDialog.reportFailed":
      "Flas could not load the report. Close this window and open it again.",
  },
  ar: {
    "healthReportDialog.encryptedStoredCredentialS":
      "شُفّرت {sealedNow} من بيانات الاعتماد المخزَّنة.",
    "healthReportDialog.nothingNeededEncrypting": "لا شيء يحتاج تشفيرًا.",
    "healthReportDialog.healthReport": "تقرير الحالة",
    "healthReportDialog.integrationHealthReport": "تقرير حالة التكاملات",
    "healthReportDialog.statusLastErrorMissingPermissions":
      "الحالة وآخر خطأ والصلاحيات الناقصة وخطوة إعادة المحاولة التالية لموصلات المنصات الـ {oauthPlatforms} التي تسجّل الدخول عبر OAuth. أما الـ {keyedOrPlugin} الأخرى — {join} — فتُربط بمفاتيح أو بإضافة لا بتسجيل دخول، ولذلك تُفحص في بطاقاتها. صدّر هذا التقرير وشاركه مع مالك الحساب.",
    "healthReportDialog.connected": "{connected} متصل",
    "healthReportDialog.needAttention": "{needsattention} تحتاج انتباهًا",
    "healthReportDialog.notConnected": "{notconnected} غير متصل",
    "healthReportDialog.encrypting": "جارٍ التشفير…",
    "healthReportDialog.encryptNow": "شفّر الآن",
    "healthReportDialog.lastError": "آخر خطأ: {lasterror}",
    "healthReportDialog.missingPermissions": "الصلاحيات الناقصة: {join}",
    "healthReportDialog.nextStep": "الخطوة التالية:",
    "healthReportDialog.retryNow": "أعد المحاولة الآن",
    "healthReportDialog.reasonNotVerified":
      "تم التفويض، لكن Flas لم يتأكد بعد مع {Platform} من أن الرمز يعمل.",
    "healthReportDialog.fixNotVerified":
      "اضغط «تحقق الآن». يفحص Flas الأمر مع {Platform} ويحفظ النتيجة.",
    "healthReportDialog.reasonEvidenceUnavailable":
      "لا يستطيع Flas حفظ نتائج التحقق لمساحة العمل هذه بعد، لذلك لا يمكن وسم هذا الحساب بأنه موثّق.",
    "healthReportDialog.fixEvidenceUnavailable":
      "اطلب من دعم Flas إكمال تحديث قاعدة البيانات، ثم اضغط «تحقق الآن».",
    "healthReportDialog.reasonScopesUnknown":
      "تقبل {Platform} الرمز لكنها لم تُدرج أذوناته، لذلك لا يستطيع Flas تأكيدها.",
    "healthReportDialog.fixKeepPermissions": "أعد الاتصال وأبقِ كل الأذونات مفعّلة.",
    "healthReportDialog.reasonScopesMissing":
      "تم الاتصال، لكن {Platform} لم تمنح ما تحتاجه هذه الميزات: {features}. تبقى معطّلة.",
    "healthReportDialog.reasonConnected":
      "تم التحقق في {verified}. قبلت {Platform} الرمز ومُنحت كل الأذونات التي يحتاجها Flas. آخر مزامنة: {synced}.",
    "healthReportDialog.connectedNotProven":
      "هذا الفحص لا يثبت أن {features} تعمل. فهذا يعتمد على مراجعة {Platform} للتطبيق.",
    "healthReportDialog.reasonVerifiedNotSynced":
      "تم التحقق في {verified}، لكن المزامنة الأولى لم تنتهِ بعد.",
    "healthReportDialog.fixVerifiedNotSynced":
      "اضغط «زامن الآن». إذا بقي فارغًا فقد يكون تطبيق المنصة ما زال قيد المراجعة أو في وضع التطوير.",
    "healthReportDialog.reasonDisconnected": "قام أحد أعضاء مساحة العمل هذه بفصل هذا الحساب عمدًا.",
    "healthReportDialog.fixDisconnected": "اربطه مرة أخرى متى احتجت إليه.",
    "healthReportDialog.labelDisconnected": "مفصول",
    "healthReportDialog.labelProviderUnavailable": "المنصة غير متاحة",
    "healthReportDialog.labelUnverified": "لم يتم التحقق بعد",
    "healthReportDialog.reasonProviderUnavailable":
      "{Platform} لا تستجيب أو تحدّ من الطلبات. لم يتغيّر اتصالك.",
    "healthReportDialog.fixProviderUnavailable":
      "لا حاجة لأي إجراء الآن. اضغط «أعد المحاولة الآن» بعد {time}.",
    "healthReportDialog.fixProviderUnavailableSoon":
      "لا حاجة لأي إجراء الآن. اضغط «أعد المحاولة الآن» بعد بضع دقائق.",
    "healthReportDialog.reasonUnidentified": "تم حفظ تسجيل الدخول هذا، لكن لم يتم اختيار حساب بعد.",
    "healthReportDialog.fixUnidentified": "اختر الحساب الذي تريد ربطه.",
    "healthReportDialog.outcomeVerified": "تم التحقق. قبلت {Platform} الرمز وحفظ Flas النتيجة.",
    "healthReportDialog.outcomeScopesMissing":
      "الرمز يعمل، لكن {Platform} لم تمنح: {permissions}. أعد الاتصال وأبقِ كل الأذونات مفعّلة.",
    "healthReportDialog.outcomeUnavailableStatus":
      "لم تردّ {Platform} (HTTP {status}). لم يتغيّر شيء ولم يُوسَم الحساب بأنه موثّق. حاول مرة أخرى بعد {time}.",
    "healthReportDialog.outcomeUnavailable":
      "لم تردّ {Platform}. لم يتغيّر شيء ولم يُوسَم الحساب بأنه موثّق. حاول مرة أخرى بعد {time}.",
    "healthReportDialog.outcomeRateLimited":
      "{Platform} تحدّ من الطلبات حاليًا. لم يتغيّر شيء. حاول مرة أخرى بعد بضع دقائق.",
    "healthReportDialog.outcomeNeedsReconnect": "لم تعد {Platform} تقبل هذا الرمز. أعد ربط الحساب.",
    "healthReportDialog.outcomeForbidden":
      "رفضت {Platform} الفحص (HTTP 403). على الأرجح أن أحد الأذونات ناقص. أعد الاتصال وأبقِ كل الأذونات مفعّلة.",
    "healthReportDialog.outcomeNotCheckable":
      "ليس لدى Flas فحص مباشر لـ {Platform} بعد، لذلك لا يستطيع التحقق من هذا الحساب.",
    "healthReportDialog.outcomeSaveFailed":
      "تم الفحص، لكن Flas لم يتمكن من حفظ النتيجة، لذلك لم يُوسَم أي شيء بأنه موثّق. المرجع {id}.",
    "healthReportDialog.outcomeEvidenceUnavailable":
      "قبلت {Platform} الرمز، لكن مساحة العمل هذه لا تستطيع تخزين نتائج التحقق بعد. المرجع {id}.",
    "healthReportDialog.outcomeSkippedDisconnected":
      "تم فصل هذا الحساب عمدًا. اربطه مرة أخرى لاستخدامه.",
    "healthReportDialog.outcomeInProgress":
      "هناك فحص آخر لهذا الحساب قيد التشغيل بالفعل. حاول مرة أخرى بعد دقيقة.",
    "healthReportDialog.outcomeRecentlyChecked": "تم الفحص قبل لحظات. يتم عرض النتيجة المحفوظة.",
    "healthReportDialog.outcomeReconnectNeeded":
      "أُضيف هذا الحساب برمز تم لصقه. أعد ربطه ليتمكن Flas من التحقق منه.",
    "healthReportDialog.outcomeFailed": "تعذّر إكمال الفحص، لذلك لم يتغيّر شيء. المرجع {id}.",
    "healthReportDialog.outcomeNotFound": "لم يتم العثور على هذا الحساب في مساحة العمل هذه.",
    "healthReportDialog.onlyCompanyAdmin": "يستطيع مسؤول الشركة فقط فحص الاتصالات.",
    "healthReportDialog.checkedSummary":
      "تم فحص {n} حساب: {verified} موثّق، و{attention} تحتاج إلى انتباه، و{skipped} لم تُفحص.",
    "healthReportDialog.nothingNeededCheck": "لا شيء يحتاج إلى فحص الآن.",
    "healthReportDialog.verifyNow": "تحقق الآن",
    "healthReportDialog.reconnect": "أعد الاتصال",
    "healthReportDialog.chooseAccount": "اختر الحساب",
    "healthReportDialog.continueWith": "المتابعة مع {Platform}",
    "healthReportDialog.comingSoon": "قريبًا",
    "healthReportDialog.checkAttention": "افحص ما حان موعد فحصه",
    "healthReportDialog.recentChecks": "الفحوصات الأخيرة",
    "healthReportDialog.diagReference": "المرجع {id}",
    "healthReportDialog.diagStage": "المرحلة: {stage}",
    "healthReportDialog.diagStatus": "حالة المنصة: {status}",
    "healthReportDialog.diagLastCheck": "آخر فحص: {time}",
    "healthReportDialog.diagStorageReady": "تخزين التحقق: جاهز",
    "healthReportDialog.diagStorageMissing": "تخزين التحقق: غير متاح",
    "healthReportDialog.diagScopes": "الأذونات غير الممنوحة: {scopes}",
    "healthReportDialog.diagMessage": "ما قالته المنصة: {message}",
    "healthReportDialog.outcomeChanged":
      "تغيّر هذا الحساب أثناء فحص Flas له، لذلك لم تُحفظ النتيجة ولم يُوسَم أي شيء بأنه موثّق.",
    "healthReportDialog.reasonRefreshFailed":
      "لم تقبل المنصة تسجيل الدخول المحفوظ في آخر مرة فحصه فيها Flas.",
    "healthReportDialog.fixReconnect": "أعد الاتصال بالحساب.",
    "healthReportDialog.reasonEvidenceUnreadable":
      "لم يتمكن Flas من قراءة نتائج الفحص المحفوظة لهذا الحساب الآن، لذلك لا يستطيع القول إن كان الحساب موثّقًا.",
    "healthReportDialog.fixEvidenceUnreadable":
      "حاول مرة أخرى بعد قليل. إذا استمر ذلك، أخبر دعم Flas.",
    "healthReportDialog.whatsappElsewhere": "يُفحص واتساب في صفحة «التنبيهات والحالة».",
    "healthReportDialog.outcomeWaiting":
      "ينتظر Flas قبل أن يسأل {Platform} مرة أخرى. حاول مرة أخرى بعد {time}.",
    "healthReportDialog.diagStorageUnreadable": "تخزين التحقق: تعذّرت قراءته",
    "healthReportDialog.reportFailed":
      "تعذّر على Flas تحميل التقرير. أغلق هذه النافذة وافتحها مرة أخرى.",
  },
  ms: {
    "healthReportDialog.encryptedStoredCredentialS": "{sealedNow} kelayakan tersimpan disulitkan.",
    "healthReportDialog.nothingNeededEncrypting": "Tiada apa-apa yang perlu disulitkan.",
    "healthReportDialog.healthReport": "Laporan kesihatan",
    "healthReportDialog.integrationHealthReport": "Laporan Kesihatan Integrasi",
    "healthReportDialog.statusLastErrorMissingPermissions":
      "Status, ralat terakhir, kebenaran yang tiada dan langkah cuba semula seterusnya bagi {oauthPlatforms} penyambung platform API yang log masuk dengan OAuth. {keyedOrPlugin} yang lain — {join} — bersambung dengan kunci atau pemalam dan bukan log masuk, jadi ia disemak pada kad masing-masing. Eksport ini dan kongsikan dengan pemilik akaun.",
    "healthReportDialog.connected": "{connected} disambungkan",
    "healthReportDialog.needAttention": "{needsattention} perlu perhatian",
    "healthReportDialog.notConnected": "{notconnected} tidak disambungkan",
    "healthReportDialog.encrypting": "Menyulitkan…",
    "healthReportDialog.encryptNow": "Sulitkan sekarang",
    "healthReportDialog.lastError": "Ralat terakhir: {lasterror}",
    "healthReportDialog.missingPermissions": "Kebenaran yang tiada: {join}",
    "healthReportDialog.nextStep": "Langkah seterusnya:",
    "healthReportDialog.retryNow": "Cuba semula sekarang",
    "healthReportDialog.reasonNotVerified":
      "Dibenarkan, tetapi Flas belum mengesahkan dengan {Platform} bahawa token berfungsi.",
    "healthReportDialog.fixNotVerified":
      "Tekan Sahkan sekarang. Flas menyemak dengan {Platform} dan menyimpan keputusan.",
    "healthReportDialog.reasonEvidenceUnavailable":
      "Flas belum dapat menyimpan keputusan pengesahan untuk ruang kerja ini, jadi akaun ini tidak boleh ditandakan sebagai telah disahkan.",
    "healthReportDialog.fixEvidenceUnavailable":
      "Minta sokongan Flas menyiapkan kemas kini pangkalan data, kemudian tekan Sahkan sekarang.",
    "healthReportDialog.reasonScopesUnknown":
      "{Platform} menerima token tetapi tidak menyenaraikan kebenarannya, jadi Flas tidak dapat mengesahkannya.",
    "healthReportDialog.fixKeepPermissions":
      "Sambung semula dan biarkan setiap kebenaran dihidupkan.",
    "healthReportDialog.reasonScopesMissing":
      "Disambungkan, tetapi {Platform} tidak memberikan apa yang diperlukan oleh ciri ini: {features}. Ciri itu kekal dimatikan.",
    "healthReportDialog.reasonConnected":
      "Disahkan pada {verified}. {Platform} menerima token dan semua kebenaran yang diperlukan Flas telah diberikan. Penyegerakan terakhir: {synced}.",
    "healthReportDialog.connectedNotProven":
      "Semakan ini tidak membuktikan bahawa {features} berfungsi. Itu bergantung pada semakan apl oleh {Platform}.",
    "healthReportDialog.reasonVerifiedNotSynced":
      "Disahkan pada {verified}, tetapi penyegerakan pertama belum selesai.",
    "healthReportDialog.fixVerifiedNotSynced":
      "Tekan Segerak sekarang. Jika masih kosong, apl platform mungkin masih dalam semakan atau mod pembangunan.",
    "healthReportDialog.reasonDisconnected":
      "Seseorang dalam ruang kerja ini memutuskan akaun ini dengan sengaja.",
    "healthReportDialog.fixDisconnected": "Sambungkannya semula bila-bila masa anda memerlukannya.",
    "healthReportDialog.labelDisconnected": "Diputuskan",
    "healthReportDialog.labelProviderUnavailable": "Platform tidak tersedia",
    "healthReportDialog.labelUnverified": "Belum disahkan",
    "healthReportDialog.reasonProviderUnavailable":
      "{Platform} tidak menjawab atau sedang mengehadkan permintaan. Sambungan anda tidak diubah.",
    "healthReportDialog.fixProviderUnavailable":
      "Tiada apa-apa untuk dilakukan sekarang. Tekan Cuba semula sekarang selepas {time}.",
    "healthReportDialog.fixProviderUnavailableSoon":
      "Tiada apa-apa untuk dilakukan sekarang. Tekan Cuba semula sekarang dalam beberapa minit.",
    "healthReportDialog.reasonUnidentified":
      "Log masuk ini disimpan, tetapi belum ada akaun yang dipilih.",
    "healthReportDialog.fixUnidentified": "Pilih akaun yang hendak disambungkan.",
    "healthReportDialog.outcomeVerified":
      "Disahkan. {Platform} menerima token dan Flas telah menyimpan keputusannya.",
    "healthReportDialog.outcomeScopesMissing":
      "Token berfungsi, tetapi {Platform} tidak memberikan: {permissions}. Sambung semula dan biarkan setiap kebenaran dihidupkan.",
    "healthReportDialog.outcomeUnavailableStatus":
      "{Platform} tidak menjawab (HTTP {status}). Tiada apa-apa yang diubah dan akaun tidak ditandakan sebagai disahkan. Cuba lagi selepas {time}.",
    "healthReportDialog.outcomeUnavailable":
      "{Platform} tidak menjawab. Tiada apa-apa yang diubah dan akaun tidak ditandakan sebagai disahkan. Cuba lagi selepas {time}.",
    "healthReportDialog.outcomeRateLimited":
      "{Platform} sedang mengehadkan permintaan sekarang. Tiada apa-apa yang diubah. Cuba lagi dalam beberapa minit.",
    "healthReportDialog.outcomeNeedsReconnect":
      "{Platform} tidak lagi menerima token ini. Sambung semula akaun.",
    "healthReportDialog.outcomeForbidden":
      "{Platform} menolak semakan (HTTP 403). Mungkin ada kebenaran yang tiada. Sambung semula dan biarkan setiap kebenaran dihidupkan.",
    "healthReportDialog.outcomeNotCheckable":
      "Flas belum mempunyai semakan langsung untuk {Platform}, jadi tidak dapat mengesahkan akaun ini.",
    "healthReportDialog.outcomeSaveFailed":
      "Semakan telah dijalankan, tetapi Flas tidak dapat menyimpan keputusan, jadi tiada apa-apa yang ditandakan sebagai disahkan. Rujukan {id}.",
    "healthReportDialog.outcomeEvidenceUnavailable":
      "{Platform} menerima token, tetapi ruang kerja ini belum dapat menyimpan keputusan pengesahan. Rujukan {id}.",
    "healthReportDialog.outcomeSkippedDisconnected":
      "Akaun ini diputuskan dengan sengaja. Sambungkannya semula untuk menggunakannya.",
    "healthReportDialog.outcomeInProgress":
      "Satu lagi semakan untuk akaun ini sedang berjalan. Cuba lagi dalam seminit.",
    "healthReportDialog.outcomeRecentlyChecked":
      "Disemak sebentar tadi. Memaparkan keputusan yang disimpan.",
    "healthReportDialog.outcomeReconnectNeeded":
      "Akaun ini ditambah dengan token yang ditampal. Sambungkannya semula supaya Flas dapat mengesahkannya.",
    "healthReportDialog.outcomeFailed":
      "Semakan tidak dapat diselesaikan, jadi tiada apa-apa yang diubah. Rujukan {id}.",
    "healthReportDialog.outcomeNotFound": "Akaun itu tidak ditemui dalam ruang kerja ini.",
    "healthReportDialog.onlyCompanyAdmin": "Hanya pentadbir syarikat boleh menyemak sambungan.",
    "healthReportDialog.checkedSummary":
      "{n} akaun disemak: {verified} disahkan, {attention} perlu perhatian, {skipped} tidak disemak.",
    "healthReportDialog.nothingNeededCheck": "Tiada apa-apa yang perlu disemak sekarang.",
    "healthReportDialog.verifyNow": "Sahkan sekarang",
    "healthReportDialog.reconnect": "Sambung semula",
    "healthReportDialog.chooseAccount": "Pilih akaun",
    "healthReportDialog.continueWith": "Teruskan dengan {Platform}",
    "healthReportDialog.comingSoon": "Akan datang",
    "healthReportDialog.checkAttention": "Semak yang sudah tiba masanya",
    "healthReportDialog.recentChecks": "Semakan terkini",
    "healthReportDialog.diagReference": "Rujukan {id}",
    "healthReportDialog.diagStage": "Peringkat: {stage}",
    "healthReportDialog.diagStatus": "Status penyedia: {status}",
    "healthReportDialog.diagLastCheck": "Semakan terakhir: {time}",
    "healthReportDialog.diagStorageReady": "Storan pengesahan: sedia",
    "healthReportDialog.diagStorageMissing": "Storan pengesahan: tidak tersedia",
    "healthReportDialog.diagScopes": "Kebenaran tidak diberikan: {scopes}",
    "healthReportDialog.diagMessage": "Platform berkata: {message}",
    "healthReportDialog.outcomeChanged":
      "Akaun ini berubah semasa Flas sedang memeriksanya, jadi keputusan tidak disimpan dan tiada apa-apa yang ditandakan sebagai disahkan.",
    "healthReportDialog.reasonRefreshFailed":
      "Platform tidak menerima log masuk yang disimpan semasa Flas menyemaknya kali terakhir.",
    "healthReportDialog.fixReconnect": "Sambung semula akaun.",
    "healthReportDialog.reasonEvidenceUnreadable":
      "Flas tidak dapat membaca keputusan semakan yang disimpan untuk akaun ini sebentar tadi, jadi ia tidak dapat memastikan sama ada akaun ini telah disahkan.",
    "healthReportDialog.fixEvidenceUnreadable":
      "Cuba lagi sebentar nanti. Jika ia berterusan, beritahu sokongan Flas.",
    "healthReportDialog.whatsappElsewhere": "WhatsApp disemak pada halaman Amaran & Kesihatan.",
    "healthReportDialog.outcomeWaiting":
      "Flas sedang menunggu sebelum bertanya kepada {Platform} semula. Cuba lagi selepas {time}.",
    "healthReportDialog.diagStorageUnreadable": "Storan pengesahan: tidak dapat dibaca",
    "healthReportDialog.reportFailed":
      "Flas tidak dapat memuatkan laporan. Tutup tetingkap ini dan buka semula.",
  },
  fil: {
    "healthReportDialog.encryptedStoredCredentialS":
      "Na-encrypt ang {sealedNow} nakaimbak na credential.",
    "healthReportDialog.nothingNeededEncrypting": "Walang kailangang i-encrypt.",
    "healthReportDialog.healthReport": "Health report",
    "healthReportDialog.integrationHealthReport": "Health Report ng mga Integrasyon",
    "healthReportDialog.statusLastErrorMissingPermissions":
      "Status, huling error, mga kulang na pahintulot at susunod na hakbang sa muling pagsubok para sa {oauthPlatforms} API platform connector na nagsa-sign in gamit ang OAuth. Ang iba pang {keyedOrPlugin} — {join} — ay kumokonekta gamit ang mga key o plugin sa halip na login, kaya sinusuri ang mga ito sa sarili nilang card. I-export ito at ibahagi sa may-ari ng account.",
    "healthReportDialog.connected": "{connected} nakakonekta",
    "healthReportDialog.needAttention": "{needsattention} ang kailangan ng atensyon",
    "healthReportDialog.notConnected": "{notconnected} hindi nakakonekta",
    "healthReportDialog.encrypting": "Ine-encrypt…",
    "healthReportDialog.encryptNow": "I-encrypt ngayon",
    "healthReportDialog.lastError": "Huling error: {lasterror}",
    "healthReportDialog.missingPermissions": "Mga kulang na pahintulot: {join}",
    "healthReportDialog.nextStep": "Susunod na hakbang:",
    "healthReportDialog.retryNow": "Subukang muli ngayon",
    "healthReportDialog.reasonNotVerified":
      "Naawtorisa na, pero hindi pa nakukumpirma ng Flas sa {Platform} na gumagana ang token.",
    "healthReportDialog.fixNotVerified":
      "Pindutin ang I-verify ngayon. Susuriin ito ng Flas sa {Platform} at ise-save ang resulta.",
    "healthReportDialog.reasonEvidenceUnavailable":
      "Hindi pa maisave ng Flas ang mga resulta ng beripikasyon para sa workspace na ito, kaya hindi pa maaaring markahang na-verify ang account na ito.",
    "healthReportDialog.fixEvidenceUnavailable":
      "Hilingin sa support ng Flas na tapusin ang update ng database, saka pindutin ang I-verify ngayon.",
    "healthReportDialog.reasonScopesUnknown":
      "Tinatanggap ng {Platform} ang token pero hindi nito inilista ang mga pahintulot nito, kaya hindi ito makumpirma ng Flas.",
    "healthReportDialog.fixKeepPermissions":
      "Kumonekta muli at panatilihing naka-on ang bawat pahintulot.",
    "healthReportDialog.reasonScopesMissing":
      "Nakakonekta, pero hindi ibinigay ng {Platform} ang kailangan ng mga feature na ito: {features}. Mananatili silang naka-off.",
    "healthReportDialog.reasonConnected":
      "Na-verify noong {verified}. Tinanggap ng {Platform} ang token at ibinigay ang lahat ng pahintulot na kailangan ng Flas. Huling na-sync: {synced}.",
    "healthReportDialog.connectedNotProven":
      "Hindi pinatutunayan ng pagsusuring ito na gumagana ang {features}. Nakadepende iyon sa app review ng {Platform}.",
    "healthReportDialog.reasonVerifiedNotSynced":
      "Na-verify noong {verified}, pero hindi pa tapos ang unang sync.",
    "healthReportDialog.fixVerifiedNotSynced":
      "Pindutin ang I-sync ngayon. Kung mananatili itong walang laman, maaaring nasa review pa o development mode ang app ng platform.",
    "healthReportDialog.reasonDisconnected":
      "May isang tao sa workspace na ito na sadyang nag-disconnect ng account na ito.",
    "healthReportDialog.fixDisconnected": "Ikonekta itong muli kailan mo man kailanganin.",
    "healthReportDialog.labelDisconnected": "Naka-disconnect",
    "healthReportDialog.labelProviderUnavailable": "Hindi available ang platform",
    "healthReportDialog.labelUnverified": "Hindi pa na-verify",
    "healthReportDialog.reasonProviderUnavailable":
      "Hindi sumasagot ang {Platform} o nililimitahan nito ang mga request. Walang binago sa koneksyon mo.",
    "healthReportDialog.fixProviderUnavailable":
      "Walang kailangang gawin ngayon. Pindutin ang Subukang muli ngayon pagkatapos ng {time}.",
    "healthReportDialog.fixProviderUnavailableSoon":
      "Walang kailangang gawin ngayon. Pindutin ang Subukang muli ngayon pagkalipas ng ilang minuto.",
    "healthReportDialog.reasonUnidentified":
      "Naka-save na ang sign-in na ito, pero wala pang napiling account.",
    "healthReportDialog.fixUnidentified": "Piliin kung aling account ang ikokonekta.",
    "healthReportDialog.outcomeVerified":
      "Na-verify. Tinanggap ng {Platform} ang token at na-save ng Flas ang resulta.",
    "healthReportDialog.outcomeScopesMissing":
      "Gumagana ang token, pero hindi ibinigay ng {Platform}: {permissions}. Kumonekta muli at panatilihing naka-on ang bawat pahintulot.",
    "healthReportDialog.outcomeUnavailableStatus":
      "Hindi sumagot ang {Platform} (HTTP {status}). Walang binago at hindi minarkahang na-verify ang account. Subukan muli pagkatapos ng {time}.",
    "healthReportDialog.outcomeUnavailable":
      "Hindi sumagot ang {Platform}. Walang binago at hindi minarkahang na-verify ang account. Subukan muli pagkatapos ng {time}.",
    "healthReportDialog.outcomeRateLimited":
      "Nililimitahan ng {Platform} ang mga request ngayon. Walang binago. Subukan muli pagkalipas ng ilang minuto.",
    "healthReportDialog.outcomeNeedsReconnect":
      "Hindi na tinatanggap ng {Platform} ang token na ito. Ikonekta muli ang account.",
    "healthReportDialog.outcomeForbidden":
      "Tinanggihan ng {Platform} ang pagsusuri (HTTP 403). Malamang may kulang na pahintulot. Kumonekta muli at panatilihing naka-on ang bawat pahintulot.",
    "healthReportDialog.outcomeNotCheckable":
      "Wala pang live na pagsusuri ang Flas para sa {Platform}, kaya hindi nito ma-verify ang account na ito.",
    "healthReportDialog.outcomeSaveFailed":
      "Tumakbo ang pagsusuri, pero hindi nai-save ng Flas ang resulta, kaya walang minarkahang na-verify. Reference {id}.",
    "healthReportDialog.outcomeEvidenceUnavailable":
      "Tinanggap ng {Platform} ang token, pero hindi pa kayang itago ng workspace na ito ang mga resulta ng beripikasyon. Reference {id}.",
    "healthReportDialog.outcomeSkippedDisconnected":
      "Sadyang na-disconnect ang account na ito. Ikonekta itong muli para magamit.",
    "healthReportDialog.outcomeInProgress":
      "May isa pang pagsusuri para sa account na ito na tumatakbo na. Subukan muli pagkalipas ng isang minuto.",
    "healthReportDialog.outcomeRecentlyChecked":
      "Kasusuri lang kanina. Ipinapakita ang naka-save na resulta.",
    "healthReportDialog.outcomeReconnectNeeded":
      "Idinagdag ang account na ito gamit ang na-paste na token. Ikonekta itong muli para ma-verify ito ng Flas.",
    "healthReportDialog.outcomeFailed":
      "Hindi natapos ang pagsusuri, kaya walang binago. Reference {id}.",
    "healthReportDialog.outcomeNotFound": "Hindi nahanap ang account na iyon sa workspace na ito.",
    "healthReportDialog.onlyCompanyAdmin":
      "Tanging admin ng kumpanya ang makakapag-check ng mga koneksyon.",
    "healthReportDialog.checkedSummary":
      "Sinuri ang {n} account: {verified} na-verify, {attention} ang nangangailangan ng pansin, {skipped} ang hindi nasuri.",
    "healthReportDialog.nothingNeededCheck": "Walang kailangang suriin ngayon.",
    "healthReportDialog.verifyNow": "I-verify ngayon",
    "healthReportDialog.reconnect": "Kumonekta muli",
    "healthReportDialog.chooseAccount": "Pumili ng account",
    "healthReportDialog.continueWith": "Magpatuloy sa {Platform}",
    "healthReportDialog.comingSoon": "Malapit na",
    "healthReportDialog.checkAttention": "Suriin ang mga dapat nang suriin",
    "healthReportDialog.recentChecks": "Mga kamakailang pagsusuri",
    "healthReportDialog.diagReference": "Reference {id}",
    "healthReportDialog.diagStage": "Yugto: {stage}",
    "healthReportDialog.diagStatus": "Status ng provider: {status}",
    "healthReportDialog.diagLastCheck": "Huling pagsusuri: {time}",
    "healthReportDialog.diagStorageReady": "Imbakan ng beripikasyon: handa",
    "healthReportDialog.diagStorageMissing": "Imbakan ng beripikasyon: hindi available",
    "healthReportDialog.diagScopes": "Mga pahintulot na hindi ibinigay: {scopes}",
    "healthReportDialog.diagMessage": "Sabi ng platform: {message}",
    "healthReportDialog.outcomeChanged":
      "Nagbago ang account na ito habang sinusuri ito ng Flas, kaya hindi na-save ang resulta at walang minarkahang na-verify.",
    "healthReportDialog.reasonRefreshFailed":
      "Hindi tinanggap ng platform ang naka-save na sign-in noong huling sinuri ito ng Flas.",
    "healthReportDialog.fixReconnect": "Ikonekta muli ang account.",
    "healthReportDialog.reasonEvidenceUnreadable":
      "Hindi nabasa ng Flas ang mga naka-save na resulta ng pagsusuri para sa account na ito ngayon, kaya hindi nito masabi kung na-verify ang account.",
    "healthReportDialog.fixEvidenceUnreadable":
      "Subukan muli sa ilang sandali. Kung patuloy itong nangyayari, sabihin sa support ng Flas.",
    "healthReportDialog.whatsappElsewhere":
      "Sinusuri ang WhatsApp sa pahina ng Mga Alerto at Kalusugan.",
    "healthReportDialog.outcomeWaiting":
      "Naghihintay muna ang Flas bago magtanong muli sa {Platform}. Subukan muli pagkatapos ng {time}.",
    "healthReportDialog.diagStorageUnreadable": "Imbakan ng beripikasyon: hindi nabasa",
    "healthReportDialog.reportFailed":
      "Hindi ma-load ng Flas ang ulat. Isara ang window na ito at buksan muli.",
  },
  sw: {
    "healthReportDialog.encryptedStoredCredentialS":
      "Vitambulisho {sealedNow} vilivyohifadhiwa vimesimbwa.",
    "healthReportDialog.nothingNeededEncrypting": "Hakuna kilichohitaji kusimbwa.",
    "healthReportDialog.healthReport": "Ripoti ya hali",
    "healthReportDialog.integrationHealthReport": "Ripoti ya Hali ya Miunganisho",
    "healthReportDialog.statusLastErrorMissingPermissions":
      "Hali, hitilafu ya mwisho, ruhusa zinazokosekana na hatua inayofuata ya kujaribu tena kwa viunganishi {oauthPlatforms} vya majukwaa ya API vinavyoingia kwa OAuth. Vingine {keyedOrPlugin} — {join} — huunganishwa kwa funguo au programu-jalizi badala ya kuingia, kwa hiyo hukaguliwa kwenye kadi zake. Hamisha ripoti hii na uishiriki na mmiliki wa akaunti.",
    "healthReportDialog.connected": "{connected} zimeunganishwa",
    "healthReportDialog.needAttention": "{needsattention} zinahitaji uangalizi",
    "healthReportDialog.notConnected": "{notconnected} hazijaunganishwa",
    "healthReportDialog.encrypting": "Inasimba…",
    "healthReportDialog.encryptNow": "Simba sasa",
    "healthReportDialog.lastError": "Hitilafu ya mwisho: {lasterror}",
    "healthReportDialog.missingPermissions": "Ruhusa zinazokosekana: {join}",
    "healthReportDialog.nextStep": "Hatua inayofuata:",
    "healthReportDialog.retryNow": "Jaribu tena sasa",
    "healthReportDialog.reasonNotVerified":
      "Imeidhinishwa, lakini Flas bado haijathibitisha na {Platform} kwamba tokeni inafanya kazi.",
    "healthReportDialog.fixNotVerified":
      "Bonyeza Thibitisha sasa. Flas inakagua na {Platform} na kuhifadhi matokeo.",
    "healthReportDialog.reasonEvidenceUnavailable":
      "Flas bado haiwezi kuhifadhi matokeo ya uthibitisho kwa nafasi hii ya kazi, kwa hiyo akaunti hii haiwezi kuwekwa alama kuwa imethibitishwa.",
    "healthReportDialog.fixEvidenceUnavailable":
      "Omba msaada wa Flas ukamilishe usasishaji wa hifadhidata, kisha bonyeza Thibitisha sasa.",
    "healthReportDialog.reasonScopesUnknown":
      "{Platform} inakubali tokeni lakini haikuorodhesha ruhusa zake, kwa hiyo Flas haiwezi kuzithibitisha.",
    "healthReportDialog.fixKeepPermissions":
      "Unganisha tena na uweke ruhusa zote zikiwa zimewashwa.",
    "healthReportDialog.reasonScopesMissing":
      "Imeunganishwa, lakini {Platform} haikutoa kile ambacho vipengele hivi vinahitaji: {features}. Vinabaki vimezimwa.",
    "healthReportDialog.reasonConnected":
      "Imethibitishwa {verified}. {Platform} ilikubali tokeni na ruhusa zote ambazo Flas inahitaji zilitolewa. Usawazishaji wa mwisho: {synced}.",
    "healthReportDialog.connectedNotProven":
      "Ukaguzi huu haudhibitishi kwamba {features} inafanya kazi. Hilo linategemea mapitio ya programu na {Platform}.",
    "healthReportDialog.reasonVerifiedNotSynced":
      "Imethibitishwa {verified}, lakini usawazishaji wa kwanza bado haujakamilika.",
    "healthReportDialog.fixVerifiedNotSynced":
      "Bonyeza Sawazisha sasa. Ikibaki tupu, programu ya jukwaa inaweza kuwa bado iko kwenye mapitio au hali ya uundaji.",
    "healthReportDialog.reasonDisconnected":
      "Mtu fulani katika nafasi hii ya kazi aliondoa akaunti hii kwa makusudi.",
    "healthReportDialog.fixDisconnected": "Iunganishe tena wakati wowote utakapoihitaji.",
    "healthReportDialog.labelDisconnected": "Imekatwa",
    "healthReportDialog.labelProviderUnavailable": "Jukwaa halipatikani",
    "healthReportDialog.labelUnverified": "Haijathibitishwa bado",
    "healthReportDialog.reasonProviderUnavailable":
      "{Platform} haijibu au inapunguza maombi. Muunganisho wako haujabadilishwa.",
    "healthReportDialog.fixProviderUnavailable":
      "Hakuna cha kufanya sasa. Bonyeza Jaribu tena sasa baada ya {time}.",
    "healthReportDialog.fixProviderUnavailableSoon":
      "Hakuna cha kufanya sasa. Bonyeza Jaribu tena sasa baada ya dakika chache.",
    "healthReportDialog.reasonUnidentified":
      "Kuingia huku kumehifadhiwa, lakini hakuna akaunti iliyochaguliwa bado.",
    "healthReportDialog.fixUnidentified": "Chagua akaunti ya kuunganisha.",
    "healthReportDialog.outcomeVerified":
      "Imethibitishwa. {Platform} ilikubali tokeni na Flas ilihifadhi matokeo.",
    "healthReportDialog.outcomeScopesMissing":
      "Tokeni inafanya kazi, lakini {Platform} haikutoa: {permissions}. Unganisha tena na uweke ruhusa zote zikiwa zimewashwa.",
    "healthReportDialog.outcomeUnavailableStatus":
      "{Platform} haikujibu (HTTP {status}). Hakuna kilichobadilishwa na akaunti haikuwekwa alama kuwa imethibitishwa. Jaribu tena baada ya {time}.",
    "healthReportDialog.outcomeUnavailable":
      "{Platform} haikujibu. Hakuna kilichobadilishwa na akaunti haikuwekwa alama kuwa imethibitishwa. Jaribu tena baada ya {time}.",
    "healthReportDialog.outcomeRateLimited":
      "{Platform} inapunguza maombi kwa sasa. Hakuna kilichobadilishwa. Jaribu tena baada ya dakika chache.",
    "healthReportDialog.outcomeNeedsReconnect":
      "{Platform} haikubali tena tokeni hii. Unganisha tena akaunti.",
    "healthReportDialog.outcomeForbidden":
      "{Platform} ilikataa ukaguzi (HTTP 403). Huenda ruhusa fulani inakosekana. Unganisha tena na uweke ruhusa zote zikiwa zimewashwa.",
    "healthReportDialog.outcomeNotCheckable":
      "Flas bado haina ukaguzi wa moja kwa moja wa {Platform}, kwa hiyo haiwezi kuthibitisha akaunti hii.",
    "healthReportDialog.outcomeSaveFailed":
      "Ukaguzi ulifanyika, lakini Flas haikuweza kuhifadhi matokeo, kwa hiyo hakuna kilichowekwa alama kuwa kimethibitishwa. Rejea {id}.",
    "healthReportDialog.outcomeEvidenceUnavailable":
      "{Platform} ilikubali tokeni, lakini nafasi hii ya kazi bado haiwezi kuhifadhi matokeo ya uthibitisho. Rejea {id}.",
    "healthReportDialog.outcomeSkippedDisconnected":
      "Akaunti hii iliondolewa kwa makusudi. Iunganishe tena ili kuitumia.",
    "healthReportDialog.outcomeInProgress":
      "Ukaguzi mwingine wa akaunti hii tayari unaendelea. Jaribu tena baada ya dakika moja.",
    "healthReportDialog.outcomeRecentlyChecked":
      "Ilikaguliwa muda mfupi uliopita. Inaonyesha matokeo yaliyohifadhiwa.",
    "healthReportDialog.outcomeReconnectNeeded":
      "Akaunti hii iliongezwa kwa tokeni iliyobandikwa. Iunganishe tena ili Flas iweze kuithibitisha.",
    "healthReportDialog.outcomeFailed":
      "Ukaguzi haukuweza kukamilika, kwa hiyo hakuna kilichobadilishwa. Rejea {id}.",
    "healthReportDialog.outcomeNotFound": "Akaunti hiyo haikupatikana katika nafasi hii ya kazi.",
    "healthReportDialog.onlyCompanyAdmin":
      "Ni msimamizi wa kampuni pekee anayeweza kukagua miunganisho.",
    "healthReportDialog.checkedSummary":
      "Akaunti {n} zimekaguliwa: {verified} zimethibitishwa, {attention} zinahitaji uangalizi, {skipped} hazikukaguliwa.",
    "healthReportDialog.nothingNeededCheck": "Hakuna kinachohitaji ukaguzi kwa sasa.",
    "healthReportDialog.verifyNow": "Thibitisha sasa",
    "healthReportDialog.reconnect": "Unganisha tena",
    "healthReportDialog.chooseAccount": "Chagua akaunti",
    "healthReportDialog.continueWith": "Endelea na {Platform}",
    "healthReportDialog.comingSoon": "Inakuja hivi karibuni",
    "healthReportDialog.checkAttention": "Kagua vinavyostahili sasa",
    "healthReportDialog.recentChecks": "Ukaguzi wa hivi karibuni",
    "healthReportDialog.diagReference": "Rejea {id}",
    "healthReportDialog.diagStage": "Hatua: {stage}",
    "healthReportDialog.diagStatus": "Hali ya mtoa huduma: {status}",
    "healthReportDialog.diagLastCheck": "Ukaguzi wa mwisho: {time}",
    "healthReportDialog.diagStorageReady": "Hifadhi ya uthibitisho: tayari",
    "healthReportDialog.diagStorageMissing": "Hifadhi ya uthibitisho: haipatikani",
    "healthReportDialog.diagScopes": "Ruhusa ambazo hazikutolewa: {scopes}",
    "healthReportDialog.diagMessage": "Jukwaa lilisema: {message}",
    "healthReportDialog.outcomeChanged":
      "Akaunti hii ilibadilika wakati Flas ilipokuwa inaikagua, kwa hiyo matokeo hayakuhifadhiwa na hakuna kilichowekwa alama kuwa kimethibitishwa.",
    "healthReportDialog.reasonRefreshFailed":
      "Jukwaa halikukubali kuingia kulikohifadhiwa mara ya mwisho Flas ilipolikagua.",
    "healthReportDialog.fixReconnect": "Unganisha tena akaunti.",
    "healthReportDialog.reasonEvidenceUnreadable":
      "Flas haikuweza kusoma matokeo yaliyohifadhiwa ya ukaguzi wa akaunti hii sasa hivi, kwa hiyo haiwezi kusema kama akaunti imethibitishwa.",
    "healthReportDialog.fixEvidenceUnreadable":
      "Jaribu tena baada ya muda mfupi. Ikiendelea, mwambie msaada wa Flas.",
    "healthReportDialog.whatsappElsewhere":
      "WhatsApp hukaguliwa kwenye ukurasa wa Tahadhari na Hali.",
    "healthReportDialog.outcomeWaiting":
      "Flas inasubiri kabla ya kuuliza {Platform} tena. Jaribu tena baada ya {time}.",
    "healthReportDialog.diagStorageUnreadable": "Hifadhi ya uthibitisho: haikuweza kusomwa",
    "healthReportDialog.reportFailed":
      "Flas haikuweza kupakia ripoti. Funga dirisha hili kisha ulifungue tena.",
  },
});
