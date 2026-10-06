// Text for the "manageSubscriptionDialog" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "manageSubscriptionDialog.couldNotSave": "Could not save",
    "manageSubscriptionDialog.isSuspended": "{name} is suspended",
    "manageSubscriptionDialog.canUseFlasAgain": "{name} can use Flas again",
    "manageSubscriptionDialog.couldNotUpdateAccess": "Could not update access",
    "manageSubscriptionDialog.manage": "Manage",
    "manageSubscriptionDialog.subscription": "Subscription — {name}",
    "manageSubscriptionDialog.paidUntil": "{statusLabel} · paid until {paidUntilText}",
    "manageSubscriptionDialog.theyCanUseFlas": "They can use Flas.",
    "manageSubscriptionDialog.theyCannotUseFlasRight": "They cannot use Flas right now.",
    "manageSubscriptionDialog.paysByCardThroughPaddle": "Pays by card through Paddle.",
    "manageSubscriptionDialog.paysManuallyCashOrBank": "Pays manually (cash or bank transfer).",
    "manageSubscriptionDialog.paddleSetsThisCompanyS":
      "Paddle sets this company's status and paid-until date after each payment or cancellation, replacing changes made here. Use this form for corrections.",
    "manageSubscriptionDialog.recordAPayment": "Record a payment",
    "manageSubscriptionDialog.today": " (today)",
    "manageSubscriptionDialog.theirCurrentPaidUntilDate": " (their current paid-until date)",
    "manageSubscriptionDialog.setsTheStatusToPaid":
      "Sets the status to Paid and counts from {formatDay}{value}.",
    "manageSubscriptionDialog.plan": "Plan",
    "manageSubscriptionDialog.chooseAPlan": "Choose a plan",
    "manageSubscriptionDialog.status": "Status",
    "manageSubscriptionDialog.paidUntil2": "Paid until",
    "manageSubscriptionDialog.noteForTheHistoryOptional": "Note for the history (optional)",
    "manageSubscriptionDialog.eGCashAed240": "e.g. Cash AED 240 received for one year",
    "manageSubscriptionDialog.noChangesYet": "No changes yet.",
    "manageSubscriptionDialog.savingWillChange": "Saving will change:",
    "manageSubscriptionDialog.close": "Close",
    "manageSubscriptionDialog.saveChanges": "Save changes",
    "manageSubscriptionDialog.suspend": "Suspend",
    "manageSubscriptionDialog.thisCompanyIsSuspendedNobody":
      "This company is suspended: nobody at it can use Flas.",
    "manageSubscriptionDialog.suspendingCutsOffEveryoneAt":
      "Suspending cuts off everyone at this company at once, whatever they have paid. Their data is kept.",
    "manageSubscriptionDialog.liftSuspension": "Lift suspension",
    "manageSubscriptionDialog.suspendCompany": "Suspend company",
    "manageSubscriptionDialog.giveAccessAgain": "Give {name} access again?",
    "manageSubscriptionDialog.suspend2": "Suspend {name}?",
    "manageSubscriptionDialog.everyoneAtThisCompanyCan":
      "Everyone at this company can use Flas again, unless their paid-until date has passed and their status is Payment issue or Canceled.",
    "manageSubscriptionDialog.everyoneAtThisCompanyLoses":
      "Everyone at this company loses access immediately. Nothing is deleted, and you can lift the suspension at any time.",
    "manageSubscriptionDialog.cancel": "Cancel",
    "manageSubscriptionDialog.history": "History",
    "manageSubscriptionDialog.loading": "Loading…",
    "manageSubscriptionDialog.couldNotLoadHistory": "Could not load history",
    "manageSubscriptionDialog.noSubscriptionChangesRecordedYet":
      "No subscription changes recorded yet.",
  },
  ar: {
    "manageSubscriptionDialog.couldNotSave": "تعذّر الحفظ",
    "manageSubscriptionDialog.isSuspended": "أُوقفت {name}",
    "manageSubscriptionDialog.canUseFlasAgain": "يمكن لـ {name} استخدام Flas مجددًا",
    "manageSubscriptionDialog.couldNotUpdateAccess": "تعذّر تحديث الوصول",
    "manageSubscriptionDialog.manage": "إدارة",
    "manageSubscriptionDialog.subscription": "الاشتراك — {name}",
    "manageSubscriptionDialog.paidUntil": "{statusLabel} · مدفوع حتى {paidUntilText}",
    "manageSubscriptionDialog.theyCanUseFlas": "يمكنهم استخدام Flas.",
    "manageSubscriptionDialog.theyCannotUseFlasRight": "لا يمكنهم استخدام Flas حاليًا.",
    "manageSubscriptionDialog.paysByCardThroughPaddle": "تدفع بالبطاقة عبر Paddle.",
    "manageSubscriptionDialog.paysManuallyCashOrBank": "تدفع يدويًا (نقدًا أو بتحويل بنكي).",
    "manageSubscriptionDialog.paddleSetsThisCompanyS":
      "يضبط Paddle حالة هذه الشركة وتاريخ «مدفوع حتى» بعد كل دفعة أو إلغاء، مستبدلًا التغييرات المُجراة هنا. استخدم هذا النموذج للتصحيحات.",
    "manageSubscriptionDialog.recordAPayment": "تسجيل دفعة",
    "manageSubscriptionDialog.today": " (اليوم)",
    "manageSubscriptionDialog.theirCurrentPaidUntilDate": " (تاريخ «مدفوع حتى» الحالي)",
    "manageSubscriptionDialog.setsTheStatusToPaid":
      "يضبط الحالة إلى «مدفوع» ويحتسب من {formatDay}{value}.",
    "manageSubscriptionDialog.plan": "الخطة",
    "manageSubscriptionDialog.chooseAPlan": "اختر خطة",
    "manageSubscriptionDialog.status": "الحالة",
    "manageSubscriptionDialog.paidUntil2": "مدفوع حتى",
    "manageSubscriptionDialog.noteForTheHistoryOptional": "ملاحظة للسجل (اختياري)",
    "manageSubscriptionDialog.eGCashAed240": "مثال: استُلم 240 درهمًا نقدًا عن سنة واحدة",
    "manageSubscriptionDialog.noChangesYet": "لا تغييرات بعد.",
    "manageSubscriptionDialog.savingWillChange": "الحفظ سيغيّر:",
    "manageSubscriptionDialog.close": "إغلاق",
    "manageSubscriptionDialog.saveChanges": "حفظ التغييرات",
    "manageSubscriptionDialog.suspend": "تعليق",
    "manageSubscriptionDialog.thisCompanyIsSuspendedNobody":
      "هذه الشركة معلّقة: لا أحد فيها يستطيع استخدام Flas.",
    "manageSubscriptionDialog.suspendingCutsOffEveryoneAt":
      "التعليق يقطع الوصول عن كل من في هذه الشركة فورًا، مهما دفعوا. بياناتهم تبقى محفوظة.",
    "manageSubscriptionDialog.liftSuspension": "رفع التعليق",
    "manageSubscriptionDialog.suspendCompany": "تعليق الشركة",
    "manageSubscriptionDialog.giveAccessAgain": "إعادة الوصول إلى {name}؟",
    "manageSubscriptionDialog.suspend2": "تعليق {name}؟",
    "manageSubscriptionDialog.everyoneAtThisCompanyCan":
      "يستطيع كل من في هذه الشركة استخدام Flas مجددًا، ما لم يكن تاريخ «مدفوع حتى» قد انقضى وحالتهم «مشكلة في الدفع» أو «ملغى».",
    "manageSubscriptionDialog.everyoneAtThisCompanyLoses":
      "يفقد كل من في هذه الشركة الوصول فورًا. لا يُحذف شيء، ويمكنك رفع التعليق في أي وقت.",
    "manageSubscriptionDialog.cancel": "إلغاء",
    "manageSubscriptionDialog.history": "السجل",
    "manageSubscriptionDialog.loading": "جارٍ التحميل…",
    "manageSubscriptionDialog.couldNotLoadHistory": "تعذّر تحميل السجل",
    "manageSubscriptionDialog.noSubscriptionChangesRecordedYet":
      "لم تُسجَّل تغييرات على الاشتراك بعد.",
  },
  ms: {
    "manageSubscriptionDialog.couldNotSave": "Tidak dapat menyimpan",
    "manageSubscriptionDialog.isSuspended": "{name} digantung",
    "manageSubscriptionDialog.canUseFlasAgain": "{name} boleh menggunakan Flas semula",
    "manageSubscriptionDialog.couldNotUpdateAccess": "Tidak dapat mengemas kini akses",
    "manageSubscriptionDialog.manage": "Urus",
    "manageSubscriptionDialog.subscription": "Langganan — {name}",
    "manageSubscriptionDialog.paidUntil": "{statusLabel} · dibayar sehingga {paidUntilText}",
    "manageSubscriptionDialog.theyCanUseFlas": "Mereka boleh menggunakan Flas.",
    "manageSubscriptionDialog.theyCannotUseFlasRight":
      "Mereka tidak boleh menggunakan Flas sekarang.",
    "manageSubscriptionDialog.paysByCardThroughPaddle": "Membayar dengan kad melalui Paddle.",
    "manageSubscriptionDialog.paysManuallyCashOrBank":
      "Membayar secara manual (tunai atau pindahan bank).",
    "manageSubscriptionDialog.paddleSetsThisCompanyS":
      "Paddle menetapkan status dan tarikh dibayar-sehingga syarikat ini selepas setiap bayaran atau pembatalan, menggantikan perubahan yang dibuat di sini. Gunakan borang ini untuk pembetulan.",
    "manageSubscriptionDialog.recordAPayment": "Rekod bayaran",
    "manageSubscriptionDialog.today": " (hari ini)",
    "manageSubscriptionDialog.theirCurrentPaidUntilDate":
      " (tarikh dibayar-sehingga semasa mereka)",
    "manageSubscriptionDialog.setsTheStatusToPaid":
      "Menetapkan status kepada Dibayar dan mengira dari {formatDay}{value}.",
    "manageSubscriptionDialog.plan": "Pelan",
    "manageSubscriptionDialog.chooseAPlan": "Pilih pelan",
    "manageSubscriptionDialog.status": "Status",
    "manageSubscriptionDialog.paidUntil2": "Dibayar sehingga",
    "manageSubscriptionDialog.noteForTheHistoryOptional": "Nota untuk sejarah (pilihan)",
    "manageSubscriptionDialog.eGCashAed240": "cth. Tunai AED 240 diterima untuk setahun",
    "manageSubscriptionDialog.noChangesYet": "Belum ada perubahan.",
    "manageSubscriptionDialog.savingWillChange": "Menyimpan akan mengubah:",
    "manageSubscriptionDialog.close": "Tutup",
    "manageSubscriptionDialog.saveChanges": "Simpan perubahan",
    "manageSubscriptionDialog.suspend": "Gantung",
    "manageSubscriptionDialog.thisCompanyIsSuspendedNobody":
      "Syarikat ini digantung: tiada sesiapa di dalamnya boleh menggunakan Flas.",
    "manageSubscriptionDialog.suspendingCutsOffEveryoneAt":
      "Penggantungan memutuskan semua orang di syarikat ini serentak, tidak kira apa yang telah mereka bayar. Data mereka disimpan.",
    "manageSubscriptionDialog.liftSuspension": "Tarik balik penggantungan",
    "manageSubscriptionDialog.suspendCompany": "Gantung syarikat",
    "manageSubscriptionDialog.giveAccessAgain": "Beri {name} akses semula?",
    "manageSubscriptionDialog.suspend2": "Gantung {name}?",
    "manageSubscriptionDialog.everyoneAtThisCompanyCan":
      "Semua orang di syarikat ini boleh menggunakan Flas semula, melainkan tarikh dibayar-sehingga mereka telah berlalu dan status mereka ialah Isu bayaran atau Dibatalkan.",
    "manageSubscriptionDialog.everyoneAtThisCompanyLoses":
      "Semua orang di syarikat ini hilang akses serta-merta. Tiada apa-apa dipadam, dan anda boleh menarik balik penggantungan pada bila-bila masa.",
    "manageSubscriptionDialog.cancel": "Batal",
    "manageSubscriptionDialog.history": "Sejarah",
    "manageSubscriptionDialog.loading": "Memuatkan…",
    "manageSubscriptionDialog.couldNotLoadHistory": "Tidak dapat memuatkan sejarah",
    "manageSubscriptionDialog.noSubscriptionChangesRecordedYet":
      "Belum ada perubahan langganan direkodkan.",
  },
  fil: {
    "manageSubscriptionDialog.couldNotSave": "Hindi ma-save",
    "manageSubscriptionDialog.isSuspended": "Suspendido ang {name}",
    "manageSubscriptionDialog.canUseFlasAgain": "Magagamit na muli ng {name} ang Flas",
    "manageSubscriptionDialog.couldNotUpdateAccess": "Hindi ma-update ang access",
    "manageSubscriptionDialog.manage": "Pamahalaan",
    "manageSubscriptionDialog.subscription": "Subscription — {name}",
    "manageSubscriptionDialog.paidUntil": "{statusLabel} · bayad hanggang {paidUntilText}",
    "manageSubscriptionDialog.theyCanUseFlas": "Magagamit nila ang Flas.",
    "manageSubscriptionDialog.theyCannotUseFlasRight": "Hindi nila magagamit ang Flas sa ngayon.",
    "manageSubscriptionDialog.paysByCardThroughPaddle": "Nagbabayad gamit ang card sa Paddle.",
    "manageSubscriptionDialog.paysManuallyCashOrBank":
      "Nagbabayad nang mano-mano (cash o bank transfer).",
    "manageSubscriptionDialog.paddleSetsThisCompanyS":
      "Itinatakda ng Paddle ang status at paid-until date ng kumpanyang ito pagkatapos ng bawat bayad o pagkansela, at pinapalitan ang mga pagbabagong ginawa rito. Gamitin ang form na ito para sa mga pagwawasto.",
    "manageSubscriptionDialog.recordAPayment": "Magtala ng bayad",
    "manageSubscriptionDialog.today": " (ngayong araw)",
    "manageSubscriptionDialog.theirCurrentPaidUntilDate": " (kasalukuyan nilang paid-until date)",
    "manageSubscriptionDialog.setsTheStatusToPaid":
      "Itinatakda ang status sa Bayad at nagbibilang mula {formatDay}{value}.",
    "manageSubscriptionDialog.plan": "Plan",
    "manageSubscriptionDialog.chooseAPlan": "Pumili ng plan",
    "manageSubscriptionDialog.status": "Status",
    "manageSubscriptionDialog.paidUntil2": "Bayad hanggang",
    "manageSubscriptionDialog.noteForTheHistoryOptional": "Tala para sa history (opsyonal)",
    "manageSubscriptionDialog.eGCashAed240":
      "hal. Natanggap ang cash na AED 240 para sa isang taon",
    "manageSubscriptionDialog.noChangesYet": "Wala pang pagbabago.",
    "manageSubscriptionDialog.savingWillChange": "Babaguhin ng pag-save ang:",
    "manageSubscriptionDialog.close": "Isara",
    "manageSubscriptionDialog.saveChanges": "I-save ang mga pagbabago",
    "manageSubscriptionDialog.suspend": "I-suspend",
    "manageSubscriptionDialog.thisCompanyIsSuspendedNobody":
      "Suspendido ang kumpanyang ito: walang sinuman dito ang makakagamit ng Flas.",
    "manageSubscriptionDialog.suspendingCutsOffEveryoneAt":
      "Pinuputol ng pag-suspend ang lahat sa kumpanyang ito nang sabay-sabay, anuman ang nabayaran nila. Nananatili ang kanilang data.",
    "manageSubscriptionDialog.liftSuspension": "Alisin ang suspension",
    "manageSubscriptionDialog.suspendCompany": "I-suspend ang kumpanya",
    "manageSubscriptionDialog.giveAccessAgain": "Bigyan muli ng access ang {name}?",
    "manageSubscriptionDialog.suspend2": "I-suspend ang {name}?",
    "manageSubscriptionDialog.everyoneAtThisCompanyCan":
      "Magagamit muli ng lahat sa kumpanyang ito ang Flas, maliban kung lumipas na ang kanilang paid-until date at ang status nila ay May problema sa bayad o Kinansela.",
    "manageSubscriptionDialog.everyoneAtThisCompanyLoses":
      "Agad na mawawalan ng access ang lahat sa kumpanyang ito. Walang nade-delete, at maaari mong alisin ang suspension anumang oras.",
    "manageSubscriptionDialog.cancel": "Kanselahin",
    "manageSubscriptionDialog.history": "History",
    "manageSubscriptionDialog.loading": "Nilo-load…",
    "manageSubscriptionDialog.couldNotLoadHistory": "Hindi ma-load ang history",
    "manageSubscriptionDialog.noSubscriptionChangesRecordedYet":
      "Wala pang naitalang pagbabago sa subscription.",
  },
  sw: {
    "manageSubscriptionDialog.couldNotSave": "Imeshindwa kuhifadhi",
    "manageSubscriptionDialog.isSuspended": "{name} imesimamishwa",
    "manageSubscriptionDialog.canUseFlasAgain": "{name} inaweza kutumia Flas tena",
    "manageSubscriptionDialog.couldNotUpdateAccess": "Imeshindwa kusasisha ufikiaji",
    "manageSubscriptionDialog.manage": "Simamia",
    "manageSubscriptionDialog.subscription": "Usajili — {name}",
    "manageSubscriptionDialog.paidUntil": "{statusLabel} · imelipwa hadi {paidUntilText}",
    "manageSubscriptionDialog.theyCanUseFlas": "Wanaweza kutumia Flas.",
    "manageSubscriptionDialog.theyCannotUseFlasRight": "Hawawezi kutumia Flas kwa sasa.",
    "manageSubscriptionDialog.paysByCardThroughPaddle": "Hulipa kwa kadi kupitia Paddle.",
    "manageSubscriptionDialog.paysManuallyCashOrBank":
      "Hulipa kwa mkono (pesa taslimu au uhamisho wa benki).",
    "manageSubscriptionDialog.paddleSetsThisCompanyS":
      "Paddle huweka hali na tarehe ya imelipwa-hadi ya kampuni hii baada ya kila malipo au ughairi, ikibadilisha mabadiliko yaliyofanywa hapa. Tumia fomu hii kwa marekebisho.",
    "manageSubscriptionDialog.recordAPayment": "Rekodi malipo",
    "manageSubscriptionDialog.today": " (leo)",
    "manageSubscriptionDialog.theirCurrentPaidUntilDate": " (tarehe yao ya sasa ya imelipwa-hadi)",
    "manageSubscriptionDialog.setsTheStatusToPaid":
      "Huweka hali kuwa Imelipwa na kuhesabu kuanzia {formatDay}{value}.",
    "manageSubscriptionDialog.plan": "Mpango",
    "manageSubscriptionDialog.chooseAPlan": "Chagua mpango",
    "manageSubscriptionDialog.status": "Hali",
    "manageSubscriptionDialog.paidUntil2": "Imelipwa hadi",
    "manageSubscriptionDialog.noteForTheHistoryOptional": "Maelezo ya historia (si lazima)",
    "manageSubscriptionDialog.eGCashAed240":
      "k.m. Pesa taslimu AED 240 zimepokelewa kwa mwaka mmoja",
    "manageSubscriptionDialog.noChangesYet": "Bado hakuna mabadiliko.",
    "manageSubscriptionDialog.savingWillChange": "Kuhifadhi kutabadilisha:",
    "manageSubscriptionDialog.close": "Funga",
    "manageSubscriptionDialog.saveChanges": "Hifadhi mabadiliko",
    "manageSubscriptionDialog.suspend": "Simamisha",
    "manageSubscriptionDialog.thisCompanyIsSuspendedNobody":
      "Kampuni hii imesimamishwa: hakuna mtu ndani yake anayeweza kutumia Flas.",
    "manageSubscriptionDialog.suspendingCutsOffEveryoneAt":
      "Kusimamisha hukata kila mtu katika kampuni hii mara moja, bila kujali walicholipa. Data zao huhifadhiwa.",
    "manageSubscriptionDialog.liftSuspension": "Ondoa usimamishaji",
    "manageSubscriptionDialog.suspendCompany": "Simamisha kampuni",
    "manageSubscriptionDialog.giveAccessAgain": "Uipe {name} ufikiaji tena?",
    "manageSubscriptionDialog.suspend2": "Simamisha {name}?",
    "manageSubscriptionDialog.everyoneAtThisCompanyCan":
      "Kila mtu katika kampuni hii anaweza kutumia Flas tena, isipokuwa tarehe yao ya imelipwa-hadi imepita na hali yao ni Tatizo la malipo au Imeghairiwa.",
    "manageSubscriptionDialog.everyoneAtThisCompanyLoses":
      "Kila mtu katika kampuni hii hupoteza ufikiaji mara moja. Hakuna kinachofutwa, na unaweza kuondoa usimamishaji wakati wowote.",
    "manageSubscriptionDialog.cancel": "Ghairi",
    "manageSubscriptionDialog.history": "Historia",
    "manageSubscriptionDialog.loading": "Inapakia…",
    "manageSubscriptionDialog.couldNotLoadHistory": "Imeshindwa kupakia historia",
    "manageSubscriptionDialog.noSubscriptionChangesRecordedYet":
      "Bado hakuna mabadiliko ya usajili yaliyorekodiwa.",
  },
});
