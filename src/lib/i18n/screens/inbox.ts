// Text for the "inbox" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "inbox.messageBlockedBySafetyRules": "Message blocked by safety rules",
    "inbox.savedButNotDelivered": "Saved, but not delivered: {deliveryError}",
    "inbox.followUpReminderSet": "Follow-up reminder set",
    "inbox.templateBlockedBySafetyRules": "Template blocked by safety rules",
    "inbox.templateAcceptedByWhatsappDelivery":
      "Template accepted by WhatsApp. Delivery confirmation is pending.",
    "inbox.catalogMessageInsertedPressSend": "Catalog message inserted — press Send to deliver",
    "inbox.conversationsCsvDownloaded": "Conversations CSV downloaded",
    "inbox.transcriptCsvDownloaded": "Transcript CSV downloaded",
    "inbox.inbox": "Inbox",
    "inbox.liveLastUpdate": "Live · last update {toLocaleTimeString}",
    "inbox.liveNewMessagesArriveInstantly": "Live — new messages arrive instantly",
    "inbox.reconnectingCheckingForNewMessages":
      "Reconnecting — checking for new messages every 10 seconds",
    "inbox.live": "Live",
    "inbox.connecting": "Connecting",
    "inbox.polling": "Polling",
    "inbox.downloadAllConversationsAsCsv": "Download all conversations as CSV",
    "inbox.searchChats": "Search chats",
    "inbox.searchConversations": "Search conversations",
    "inbox.loadingConversations": "Loading conversations…",
    "inbox.noConversationsYetMessagesFrom":
      "No conversations yet. Messages from WhatsApp and the website widget land here.",
    "inbox.unknown": "Unknown",
    "inbox.noMessagesYet": "No messages yet",
    "inbox.website": "Website",
    "inbox.bot": "Bot",
    "inbox.selectAConversationToStart": "Select a conversation to start monitoring.",
    "inbox.backToConversations": "Back to conversations",
    "inbox.websiteVisitor": "Website visitor",
    "inbox.showMessageTools": "Show message tools",
    "inbox.tools": "Tools",
    "inbox.aiAutoReply": "AI auto-reply",
    "inbox.autoTranslateNewIncomingMessages": "Auto-translate new incoming messages",
    "inbox.autoTranslateNew": "Auto-translate new",
    "inbox.downloadThisChatAsCsv": "Download this chat as CSV",
    "inbox.transcript": "Transcript",
    "inbox.unassigned": "Unassigned",
    "inbox.me": "Me",
    "inbox.teammate": "Teammate",
    "inbox.remove": "Remove {tag}",
    "inbox.addTag": "Add tag",
    "inbox.addConversationTag": "Add conversation tag",
    "inbox.approvedWhatsappTemplate": "Approved WhatsApp template",
    "inbox.sendApprovedTemplate": "Send approved template…",
    "inbox.sendTemplate": "Send template",
    "inbox.personalizeYourTemplate": "Personalize your template",
    "inbox.variable": "Variable {value}",
    "inbox.messagePreview": "Message preview",
    "inbox.reviewTheMessageBeforePressing": "Review the message before pressing Send template.",
    "inbox.searchProducts": "Search products",
    "inbox.searchCatalogProducts": "Search catalog products",
    "inbox.insertCatalogMessage": "Insert catalog message",
    "inbox.noProductsInCatalogYet": "No products in catalog yet.",
    "inbox.followUpNote": "Follow-up note",
    "inbox.setReminder": "Set reminder",
    "inbox.overdue": " · overdue",
    "inbox.reopen": "Reopen",
    "inbox.done": "Done",
    "inbox.assistant": "Assistant",
    "inbox.translatedFrom": "Translated from {detectedlanguage}",
    "inbox.translation": "Translation",
    "inbox.hide": "Hide",
    "inbox.showTranslation": "Show translation",
    "inbox.translate": "Translate",
    "inbox.replyToConversation": "Reply to conversation",
    "inbox.writeAReply": "Write a reply…",
    "inbox.useAnApprovedTemplateTo":
      "Use an approved template to re-open this WhatsApp conversation…",
    "inbox.thisCustomerHasNotMessaged":
      "This customer has not messaged in the past 24 hours. WhatsApp requires an approved template before you can send a normal reply.",
    "inbox.suggestReply": "Suggest reply",
    "inbox.send": "Send",
    "inbox.sending": "Sending…",
    "inbox.notDelivered": "Not delivered",
    "inbox.read": "Read",
    "inbox.delivered": "Delivered",
    "inbox.sent": "Sent",
    "inbox.sendingFrom": "Sending from {number}",
    "inbox.sendingFromTo": "Sending from {number} to {recipient}",
    "inbox.cannotSendYet": "This reply cannot be sent yet",
    "inbox.status.unconfirmed": "Not confirmed",
    "inbox.unconfirmedHint":
      "WhatsApp did not confirm this message. Check with the customer before sending it again.",
    "inbox.block.conversation_not_found": "Conversation not found.",
    "inbox.block.no_number":
      "No WhatsApp number is connected to this workspace. A company admin can connect one in Integrations.",
    "inbox.block.number_missing":
      "The WhatsApp number this conversation belongs to is no longer connected. A company admin must reconnect it in Integrations.",
    "inbox.block.number_disabled":
      "The WhatsApp number for this conversation is switched off in Integrations.",
    "inbox.block.number_needs_reconnect":
      "The WhatsApp number for this conversation has lost its connection to Meta. A company admin must reconnect it.",
    "inbox.block.workspace_suspended":
      "This workspace is suspended — contact your Flas account manager.",
    "inbox.block.subscription_inactive":
      "The workspace subscription is not active — sending is paused until the plan is active.",
    "inbox.block.contact_not_saved":
      "This number is not saved as a contact with recorded opt-in consent — WhatsApp requires consent before a template message.",
    "inbox.block.no_consent":
      "No recorded opt-in consent for this contact — WhatsApp requires consent before template or marketing messages.",
    "inbox.block.window_closed":
      "The 24-hour WhatsApp reply window has closed — send an approved template to re-open the conversation.",
    "inbox.block.routed_to_other_number":
      "Routing rules assign this lead to a different WhatsApp number — reply from that line.",
    "inbox.block.recipient_invalid":
      "This contact's number is not a complete international number. Save it in international form, for example +971 50 123 4567.",
    "inbox.sendFailure.window_closed":
      "The 24-hour WhatsApp reply window has closed. Send an approved template to re-open this chat.",
    "inbox.sendFailure.credentials":
      "The connected WhatsApp account needs to be reconnected by a company admin.",
    "inbox.sendFailure.permission":
      "The connected WhatsApp account is missing a permission this message needs. A company admin must reconnect it and approve every permission.",
    "inbox.sendFailure.template":
      "WhatsApp refused this template. Check that it is approved in this language, not paused, and that every variable is filled in.",
    "inbox.sendFailure.rate_limited":
      "WhatsApp is limiting how fast this number can send right now. Wait a few minutes before trying again.",
    "inbox.sendFailure.quality_restricted":
      "WhatsApp has restricted this number or this message because of quality or policy limits. Check the number's status in Meta before sending more.",
    "inbox.sendFailure.recipient_unreachable":
      "WhatsApp could not reach this number. Check that the customer uses WhatsApp on it.",
    "inbox.sendFailure.recipient_not_allowed":
      "This WhatsApp account is still in test mode and can only message its approved test recipients.",
    "inbox.sendFailure.recipient_opted_out":
      "This customer has opted out of marketing messages on WhatsApp.",
    "inbox.sendFailure.number_not_registered":
      "This business number is not registered or approved on WhatsApp yet. A company admin must finish its setup in Meta.",
    "inbox.sendFailure.billing":
      "WhatsApp refused the message because of a payment problem on the Meta business account.",
    "inbox.sendFailure.invalid_request":
      "WhatsApp did not accept this message as written. Check the customer's number and the message content.",
    "inbox.sendFailure.provider_unavailable":
      "WhatsApp is temporarily unavailable. The message was not sent; try again shortly.",
    "inbox.sendFailure.unknown":
      "WhatsApp did not accept this message. Ask a company admin to check the connection.",
    "inbox.sendFailure.unconfirmed":
      "WhatsApp did not confirm whether this message was sent. Do not send it again yet: check with the customer, or wait for the delivery receipt.",
  },
  ar: {
    "inbox.messageBlockedBySafetyRules": "حُظرت الرسالة وفق قواعد الأمان",
    "inbox.savedButNotDelivered": "حُفظت لكنها لم تُسلَّم: {deliveryError}",
    "inbox.followUpReminderSet": "ضُبط تذكير المتابعة",
    "inbox.templateBlockedBySafetyRules": "حُظر القالب وفق قواعد الأمان",
    "inbox.templateAcceptedByWhatsappDelivery": "قبل واتساب القالب. تأكيد التسليم قيد الانتظار.",
    "inbox.catalogMessageInsertedPressSend": "أُدرجت رسالة الكتالوج — اضغط «إرسال» لتسليمها",
    "inbox.conversationsCsvDownloaded": "تم تنزيل ملف CSV للمحادثات",
    "inbox.transcriptCsvDownloaded": "تم تنزيل ملف CSV لنص المحادثة",
    "inbox.inbox": "صندوق الوارد",
    "inbox.liveLastUpdate": "مباشر · آخر تحديث {toLocaleTimeString}",
    "inbox.liveNewMessagesArriveInstantly": "مباشر — تصل الرسائل الجديدة فورًا",
    "inbox.reconnectingCheckingForNewMessages":
      "جارٍ إعادة الاتصال — يُتحقق من الرسائل الجديدة كل 10 ثوانٍ",
    "inbox.live": "مباشر",
    "inbox.connecting": "جارٍ الاتصال",
    "inbox.polling": "تحقق دوري",
    "inbox.downloadAllConversationsAsCsv": "تنزيل كل المحادثات بصيغة CSV",
    "inbox.searchChats": "ابحث في المحادثات",
    "inbox.searchConversations": "البحث في المحادثات",
    "inbox.loadingConversations": "جارٍ تحميل المحادثات…",
    "inbox.noConversationsYetMessagesFrom":
      "لا توجد محادثات بعد. تظهر هنا الرسائل الواردة من واتساب وأداة الموقع.",
    "inbox.unknown": "غير معروف",
    "inbox.noMessagesYet": "لا توجد رسائل بعد",
    "inbox.website": "الموقع",
    "inbox.bot": "الروبوت",
    "inbox.selectAConversationToStart": "اختر محادثة لبدء المتابعة.",
    "inbox.backToConversations": "العودة إلى المحادثات",
    "inbox.websiteVisitor": "زائر الموقع",
    "inbox.showMessageTools": "إظهار أدوات الرسائل",
    "inbox.tools": "الأدوات",
    "inbox.aiAutoReply": "الرد التلقائي بالذكاء الاصطناعي",
    "inbox.autoTranslateNewIncomingMessages": "ترجمة الرسائل الواردة الجديدة تلقائيًا",
    "inbox.autoTranslateNew": "ترجمة الجديد تلقائيًا",
    "inbox.downloadThisChatAsCsv": "تنزيل هذه المحادثة بصيغة CSV",
    "inbox.transcript": "نص المحادثة",
    "inbox.unassigned": "غير مُسندة",
    "inbox.me": "أنا",
    "inbox.teammate": "زميل",
    "inbox.remove": "إزالة {tag}",
    "inbox.addTag": "إضافة وسم",
    "inbox.addConversationTag": "إضافة وسم للمحادثة",
    "inbox.approvedWhatsappTemplate": "قالب واتساب معتمد",
    "inbox.sendApprovedTemplate": "إرسال قالب معتمد…",
    "inbox.sendTemplate": "إرسال القالب",
    "inbox.personalizeYourTemplate": "خصّص قالبك",
    "inbox.variable": "المتغير {value}",
    "inbox.messagePreview": "معاينة الرسالة",
    "inbox.reviewTheMessageBeforePressing": "راجع الرسالة قبل الضغط على «إرسال القالب».",
    "inbox.searchProducts": "ابحث في المنتجات",
    "inbox.searchCatalogProducts": "البحث في منتجات الكتالوج",
    "inbox.insertCatalogMessage": "إدراج رسالة الكتالوج",
    "inbox.noProductsInCatalogYet": "لا توجد منتجات في الكتالوج بعد.",
    "inbox.followUpNote": "ملاحظة المتابعة",
    "inbox.setReminder": "ضبط تذكير",
    "inbox.overdue": " · متأخر",
    "inbox.reopen": "إعادة فتح",
    "inbox.done": "تم",
    "inbox.assistant": "المساعد",
    "inbox.translatedFrom": "مترجم من {detectedlanguage}",
    "inbox.translation": "الترجمة",
    "inbox.hide": "إخفاء",
    "inbox.showTranslation": "إظهار الترجمة",
    "inbox.translate": "ترجمة",
    "inbox.replyToConversation": "الرد على المحادثة",
    "inbox.writeAReply": "اكتب ردًا…",
    "inbox.useAnApprovedTemplateTo": "استخدم قالبًا معتمدًا لإعادة فتح محادثة واتساب هذه…",
    "inbox.thisCustomerHasNotMessaged":
      "لم يراسلك هذا العميل خلال آخر 24 ساعة. يشترط واتساب قالبًا معتمدًا قبل أن تتمكن من إرسال رد عادي.",
    "inbox.suggestReply": "اقتراح رد",
    "inbox.send": "إرسال",
    "inbox.sending": "جارٍ الإرسال…",
    "inbox.notDelivered": "لم تُسلَّم",
    "inbox.read": "مقروءة",
    "inbox.delivered": "تم التسليم",
    "inbox.sent": "أُرسلت",
    "inbox.sendingFrom": "يُرسل من {number}",
    "inbox.sendingFromTo": "يُرسل من {number} إلى {recipient}",
    "inbox.cannotSendYet": "لا يمكن إرسال هذا الرد بعد",
    "inbox.status.unconfirmed": "غير مؤكَّد",
    "inbox.unconfirmedHint": "لم يؤكد واتساب هذه الرسالة. تحقق مع العميل قبل إرسالها مجددًا.",
    "inbox.block.conversation_not_found": "المحادثة غير موجودة.",
    "inbox.block.no_number":
      "لا يوجد رقم واتساب مرتبط بمساحة العمل هذه. يمكن لمسؤول الشركة ربط رقم من التكاملات.",
    "inbox.block.number_missing":
      "رقم واتساب الذي تنتمي إليه هذه المحادثة لم يعد مرتبطًا. يجب أن يعيد مسؤول الشركة ربطه من التكاملات.",
    "inbox.block.number_disabled": "رقم واتساب الخاص بهذه المحادثة متوقف في التكاملات.",
    "inbox.block.number_needs_reconnect":
      "رقم واتساب الخاص بهذه المحادثة فقد اتصاله بـ Meta. يجب أن يعيد مسؤول الشركة ربطه.",
    "inbox.block.workspace_suspended": "مساحة العمل هذه معلّقة — تواصل مع مدير حسابك في Flas.",
    "inbox.block.subscription_inactive":
      "اشتراك مساحة العمل غير نشط — الإرسال متوقف إلى أن تُفعَّل الخطة.",
    "inbox.block.contact_not_saved":
      "هذا الرقم غير محفوظ كجهة اتصال بموافقة مسجَّلة — واتساب يشترط الموافقة قبل رسالة القالب.",
    "inbox.block.no_consent":
      "لا توجد موافقة مسجَّلة لهذه الجهة — واتساب يشترط الموافقة قبل رسائل القوالب أو التسويق.",
    "inbox.block.window_closed":
      "أُغلقت نافذة الرد على واتساب (24 ساعة) — أرسل قالبًا معتمدًا لإعادة فتح المحادثة.",
    "inbox.block.routed_to_other_number":
      "قواعد التوجيه تسند هذا العميل المحتمل إلى رقم واتساب آخر — ردّ من ذلك الخط.",
    "inbox.block.recipient_invalid":
      "رقم هذه الجهة ليس رقمًا دوليًا كاملًا. احفظه بالصيغة الدولية، مثل ‎+971 50 123 4567.",
    "inbox.sendFailure.window_closed":
      "أُغلقت نافذة الرد على واتساب (24 ساعة). أرسل قالبًا معتمدًا لإعادة فتح هذه المحادثة.",
    "inbox.sendFailure.credentials": "حساب واتساب المرتبط يحتاج أن يعيد مسؤول الشركة ربطه.",
    "inbox.sendFailure.permission":
      "حساب واتساب المرتبط تنقصه صلاحية تحتاجها هذه الرسالة. يجب أن يعيد مسؤول الشركة ربطه ويوافق على كل الصلاحيات.",
    "inbox.sendFailure.template":
      "رفض واتساب هذا القالب. تأكد أنه معتمد بهذه اللغة، وغير موقوف، وأن كل المتغيرات معبأة.",
    "inbox.sendFailure.rate_limited":
      "واتساب يحدّ الآن من سرعة إرسال هذا الرقم. انتظر بضع دقائق قبل المحاولة مجددًا.",
    "inbox.sendFailure.quality_restricted":
      "قيّد واتساب هذا الرقم أو هذه الرسالة بسبب حدود الجودة أو السياسات. راجع حالة الرقم في Meta قبل إرسال المزيد.",
    "inbox.sendFailure.recipient_unreachable":
      "تعذّر على واتساب الوصول إلى هذا الرقم. تأكد أن العميل يستخدم واتساب عليه.",
    "inbox.sendFailure.recipient_not_allowed":
      "حساب واتساب هذا ما زال في وضع الاختبار ولا يراسل إلا المستلمين التجريبيين المعتمدين.",
    "inbox.sendFailure.recipient_opted_out":
      "هذا العميل ألغى اشتراكه في الرسائل التسويقية على واتساب.",
    "inbox.sendFailure.number_not_registered":
      "رقم النشاط هذا غير مسجَّل أو غير معتمد على واتساب بعد. يجب أن يكمل مسؤول الشركة إعداده في Meta.",
    "inbox.sendFailure.billing": "رفض واتساب الرسالة بسبب مشكلة دفع في حساب Meta التجاري.",
    "inbox.sendFailure.invalid_request":
      "لم يقبل واتساب هذه الرسالة كما كُتبت. راجع رقم العميل ومحتوى الرسالة.",
    "inbox.sendFailure.provider_unavailable":
      "واتساب غير متاح مؤقتًا. لم تُرسل الرسالة؛ حاول مجددًا بعد قليل.",
    "inbox.sendFailure.unknown": "لم يقبل واتساب هذه الرسالة. اطلب من مسؤول الشركة فحص الاتصال.",
    "inbox.sendFailure.unconfirmed":
      "لم يؤكد واتساب ما إذا أُرسلت هذه الرسالة. لا ترسلها مجددًا الآن: تحقق مع العميل، أو انتظر إشعار التسليم.",
  },
  ms: {
    "inbox.messageBlockedBySafetyRules": "Mesej disekat oleh peraturan keselamatan",
    "inbox.savedButNotDelivered": "Disimpan, tetapi tidak sampai: {deliveryError}",
    "inbox.followUpReminderSet": "Peringatan susulan ditetapkan",
    "inbox.templateBlockedBySafetyRules": "Templat disekat oleh peraturan keselamatan",
    "inbox.templateAcceptedByWhatsappDelivery":
      "Templat diterima oleh WhatsApp. Pengesahan penghantaran belum diterima.",
    "inbox.catalogMessageInsertedPressSend":
      "Mesej katalog dimasukkan — tekan Hantar untuk menghantarnya",
    "inbox.conversationsCsvDownloaded": "CSV perbualan dimuat turun",
    "inbox.transcriptCsvDownloaded": "CSV transkrip dimuat turun",
    "inbox.inbox": "Peti Masuk",
    "inbox.liveLastUpdate": "Langsung · kemas kini terakhir {toLocaleTimeString}",
    "inbox.liveNewMessagesArriveInstantly": "Langsung — mesej baharu tiba serta-merta",
    "inbox.reconnectingCheckingForNewMessages":
      "Menyambung semula — menyemak mesej baharu setiap 10 saat",
    "inbox.live": "Langsung",
    "inbox.connecting": "Menyambung",
    "inbox.polling": "Menyemak berkala",
    "inbox.downloadAllConversationsAsCsv": "Muat turun semua perbualan sebagai CSV",
    "inbox.searchChats": "Cari sembang",
    "inbox.searchConversations": "Cari perbualan",
    "inbox.loadingConversations": "Memuatkan perbualan…",
    "inbox.noConversationsYetMessagesFrom":
      "Belum ada perbualan. Mesej daripada WhatsApp dan widget laman web masuk ke sini.",
    "inbox.unknown": "Tidak diketahui",
    "inbox.noMessagesYet": "Belum ada mesej",
    "inbox.website": "Laman web",
    "inbox.bot": "Bot",
    "inbox.selectAConversationToStart": "Pilih perbualan untuk mula memantau.",
    "inbox.backToConversations": "Kembali ke perbualan",
    "inbox.websiteVisitor": "Pelawat laman web",
    "inbox.showMessageTools": "Tunjukkan alat mesej",
    "inbox.tools": "Alat",
    "inbox.aiAutoReply": "Balasan automatik AI",
    "inbox.autoTranslateNewIncomingMessages": "Terjemah automatik mesej masuk baharu",
    "inbox.autoTranslateNew": "Terjemah automatik yang baharu",
    "inbox.downloadThisChatAsCsv": "Muat turun sembang ini sebagai CSV",
    "inbox.transcript": "Transkrip",
    "inbox.unassigned": "Belum ditugaskan",
    "inbox.me": "Saya",
    "inbox.teammate": "Rakan sepasukan",
    "inbox.remove": "Buang {tag}",
    "inbox.addTag": "Tambah tag",
    "inbox.addConversationTag": "Tambah tag perbualan",
    "inbox.approvedWhatsappTemplate": "Templat WhatsApp yang diluluskan",
    "inbox.sendApprovedTemplate": "Hantar templat yang diluluskan…",
    "inbox.sendTemplate": "Hantar templat",
    "inbox.personalizeYourTemplate": "Peribadikan templat anda",
    "inbox.variable": "Pemboleh ubah {value}",
    "inbox.messagePreview": "Pratonton mesej",
    "inbox.reviewTheMessageBeforePressing": "Semak mesej sebelum menekan Hantar templat.",
    "inbox.searchProducts": "Cari produk",
    "inbox.searchCatalogProducts": "Cari produk katalog",
    "inbox.insertCatalogMessage": "Masukkan mesej katalog",
    "inbox.noProductsInCatalogYet": "Belum ada produk dalam katalog.",
    "inbox.followUpNote": "Nota susulan",
    "inbox.setReminder": "Tetapkan peringatan",
    "inbox.overdue": " · tertunggak",
    "inbox.reopen": "Buka semula",
    "inbox.done": "Selesai",
    "inbox.assistant": "Pembantu",
    "inbox.translatedFrom": "Diterjemah daripada {detectedlanguage}",
    "inbox.translation": "Terjemahan",
    "inbox.hide": "Sembunyi",
    "inbox.showTranslation": "Tunjukkan terjemahan",
    "inbox.translate": "Terjemah",
    "inbox.replyToConversation": "Balas perbualan",
    "inbox.writeAReply": "Tulis balasan…",
    "inbox.useAnApprovedTemplateTo":
      "Gunakan templat yang diluluskan untuk membuka semula perbualan WhatsApp ini…",
    "inbox.thisCustomerHasNotMessaged":
      "Pelanggan ini tidak menghantar mesej dalam 24 jam yang lalu. WhatsApp memerlukan templat yang diluluskan sebelum anda boleh menghantar balasan biasa.",
    "inbox.suggestReply": "Cadangkan balasan",
    "inbox.send": "Hantar",
    "inbox.sending": "Menghantar…",
    "inbox.notDelivered": "Tidak sampai",
    "inbox.read": "Dibaca",
    "inbox.delivered": "Sampai",
    "inbox.sent": "Dihantar",
    "inbox.sendingFrom": "Dihantar dari {number}",
    "inbox.sendingFromTo": "Dihantar dari {number} kepada {recipient}",
    "inbox.cannotSendYet": "Balasan ini belum boleh dihantar",
    "inbox.status.unconfirmed": "Tidak disahkan",
    "inbox.unconfirmedHint":
      "WhatsApp tidak mengesahkan mesej ini. Semak dengan pelanggan sebelum menghantarnya lagi.",
    "inbox.block.conversation_not_found": "Perbualan tidak ditemui.",
    "inbox.block.no_number":
      "Tiada nombor WhatsApp disambungkan ke ruang kerja ini. Pentadbir syarikat boleh menyambungkannya di Integrasi.",
    "inbox.block.number_missing":
      "Nombor WhatsApp bagi perbualan ini tidak lagi disambungkan. Pentadbir syarikat mesti menyambungkannya semula di Integrasi.",
    "inbox.block.number_disabled": "Nombor WhatsApp bagi perbualan ini dimatikan di Integrasi.",
    "inbox.block.number_needs_reconnect":
      "Nombor WhatsApp bagi perbualan ini telah hilang sambungan dengan Meta. Pentadbir syarikat mesti menyambungkannya semula.",
    "inbox.block.workspace_suspended":
      "Ruang kerja ini digantung — hubungi pengurus akaun Flas anda.",
    "inbox.block.subscription_inactive":
      "Langganan ruang kerja tidak aktif — penghantaran dihentikan sehingga pelan aktif.",
    "inbox.block.contact_not_saved":
      "Nombor ini tidak disimpan sebagai kenalan dengan persetujuan yang direkodkan — WhatsApp memerlukan persetujuan sebelum mesej templat.",
    "inbox.block.no_consent":
      "Tiada persetujuan yang direkodkan untuk kenalan ini — WhatsApp memerlukan persetujuan sebelum mesej templat atau pemasaran.",
    "inbox.block.window_closed":
      "Tetingkap balasan WhatsApp 24 jam telah ditutup — hantar templat yang diluluskan untuk membuka semula perbualan.",
    "inbox.block.routed_to_other_number":
      "Peraturan penghalaan menugaskan prospek ini kepada nombor WhatsApp lain — balas dari talian itu.",
    "inbox.block.recipient_invalid":
      "Nombor kenalan ini bukan nombor antarabangsa yang lengkap. Simpan dalam bentuk antarabangsa, contohnya +971 50 123 4567.",
    "inbox.sendFailure.window_closed":
      "Tetingkap balasan WhatsApp 24 jam telah ditutup. Hantar templat yang diluluskan untuk membuka semula sembang ini.",
    "inbox.sendFailure.credentials":
      "Akaun WhatsApp yang disambungkan perlu disambung semula oleh pentadbir syarikat.",
    "inbox.sendFailure.permission":
      "Akaun WhatsApp yang disambungkan tiada kebenaran yang diperlukan mesej ini. Pentadbir syarikat mesti menyambungkannya semula dan meluluskan setiap kebenaran.",
    "inbox.sendFailure.template":
      "WhatsApp menolak templat ini. Semak bahawa ia diluluskan dalam bahasa ini, tidak dijeda, dan setiap pemboleh ubah diisi.",
    "inbox.sendFailure.rate_limited":
      "WhatsApp sedang mengehadkan kelajuan penghantaran nombor ini. Tunggu beberapa minit sebelum mencuba lagi.",
    "inbox.sendFailure.quality_restricted":
      "WhatsApp telah mengehadkan nombor ini atau mesej ini kerana had kualiti atau dasar. Semak status nombor di Meta sebelum menghantar lagi.",
    "inbox.sendFailure.recipient_unreachable":
      "WhatsApp tidak dapat menghubungi nombor ini. Semak bahawa pelanggan menggunakan WhatsApp padanya.",
    "inbox.sendFailure.recipient_not_allowed":
      "Akaun WhatsApp ini masih dalam mod ujian dan hanya boleh menghantar mesej kepada penerima ujian yang diluluskan.",
    "inbox.sendFailure.recipient_opted_out":
      "Pelanggan ini telah menarik diri daripada mesej pemasaran di WhatsApp.",
    "inbox.sendFailure.number_not_registered":
      "Nombor perniagaan ini belum didaftarkan atau diluluskan di WhatsApp. Pentadbir syarikat mesti menyelesaikan persediaannya di Meta.",
    "inbox.sendFailure.billing":
      "WhatsApp menolak mesej kerana masalah bayaran pada akaun perniagaan Meta.",
    "inbox.sendFailure.invalid_request":
      "WhatsApp tidak menerima mesej ini seperti yang ditulis. Semak nombor pelanggan dan kandungan mesej.",
    "inbox.sendFailure.provider_unavailable":
      "WhatsApp tidak tersedia buat sementara waktu. Mesej tidak dihantar; cuba lagi sebentar lagi.",
    "inbox.sendFailure.unknown":
      "WhatsApp tidak menerima mesej ini. Minta pentadbir syarikat menyemak sambungan.",
    "inbox.sendFailure.unconfirmed":
      "WhatsApp tidak mengesahkan sama ada mesej ini dihantar. Jangan hantar lagi buat masa ini: semak dengan pelanggan, atau tunggu resit penghantaran.",
  },
  fil: {
    "inbox.messageBlockedBySafetyRules": "Na-block ang mensahe ng mga panuntunan sa kaligtasan",
    "inbox.savedButNotDelivered": "Na-save, pero hindi naihatid: {deliveryError}",
    "inbox.followUpReminderSet": "Naitakda ang paalala sa follow-up",
    "inbox.templateBlockedBySafetyRules": "Na-block ang template ng mga panuntunan sa kaligtasan",
    "inbox.templateAcceptedByWhatsappDelivery":
      "Tinanggap ng WhatsApp ang template. Hinihintay pa ang kumpirmasyon ng paghahatid.",
    "inbox.catalogMessageInsertedPressSend":
      "Naipasok ang mensahe ng catalog — pindutin ang Ipadala para maihatid",
    "inbox.conversationsCsvDownloaded": "Na-download ang CSV ng mga usapan",
    "inbox.transcriptCsvDownloaded": "Na-download ang CSV ng transcript",
    "inbox.inbox": "Inbox",
    "inbox.liveLastUpdate": "Live · huling update {toLocaleTimeString}",
    "inbox.liveNewMessagesArriveInstantly": "Live — agad dumarating ang mga bagong mensahe",
    "inbox.reconnectingCheckingForNewMessages":
      "Muling kumokonekta — tinitingnan ang mga bagong mensahe tuwing 10 segundo",
    "inbox.live": "Live",
    "inbox.connecting": "Kumokonekta",
    "inbox.polling": "Pana-panahong sinusuri",
    "inbox.downloadAllConversationsAsCsv": "I-download ang lahat ng usapan bilang CSV",
    "inbox.searchChats": "Maghanap ng chat",
    "inbox.searchConversations": "Maghanap ng usapan",
    "inbox.loadingConversations": "Nilo-load ang mga usapan…",
    "inbox.noConversationsYetMessagesFrom":
      "Wala pang usapan. Dito napupunta ang mga mensahe mula sa WhatsApp at sa widget ng website.",
    "inbox.unknown": "Hindi kilala",
    "inbox.noMessagesYet": "Wala pang mensahe",
    "inbox.website": "Website",
    "inbox.bot": "Bot",
    "inbox.selectAConversationToStart": "Pumili ng usapan para simulan ang pagmo-monitor.",
    "inbox.backToConversations": "Bumalik sa mga usapan",
    "inbox.websiteVisitor": "Bisita ng website",
    "inbox.showMessageTools": "Ipakita ang mga tool sa mensahe",
    "inbox.tools": "Mga tool",
    "inbox.aiAutoReply": "AI auto-reply",
    "inbox.autoTranslateNewIncomingMessages":
      "Awtomatikong isalin ang mga bagong papasok na mensahe",
    "inbox.autoTranslateNew": "Awtomatikong isalin ang bago",
    "inbox.downloadThisChatAsCsv": "I-download ang chat na ito bilang CSV",
    "inbox.transcript": "Transcript",
    "inbox.unassigned": "Hindi naka-assign",
    "inbox.me": "Ako",
    "inbox.teammate": "Kasamahan",
    "inbox.remove": "Alisin ang {tag}",
    "inbox.addTag": "Magdagdag ng tag",
    "inbox.addConversationTag": "Magdagdag ng tag sa usapan",
    "inbox.approvedWhatsappTemplate": "Aprubadong WhatsApp template",
    "inbox.sendApprovedTemplate": "Magpadala ng aprubadong template…",
    "inbox.sendTemplate": "Ipadala ang template",
    "inbox.personalizeYourTemplate": "I-personalize ang iyong template",
    "inbox.variable": "Variable {value}",
    "inbox.messagePreview": "Preview ng mensahe",
    "inbox.reviewTheMessageBeforePressing":
      "Suriin ang mensahe bago pindutin ang Ipadala ang template.",
    "inbox.searchProducts": "Maghanap ng produkto",
    "inbox.searchCatalogProducts": "Maghanap ng produkto sa catalog",
    "inbox.insertCatalogMessage": "Ipasok ang mensahe ng catalog",
    "inbox.noProductsInCatalogYet": "Wala pang produkto sa catalog.",
    "inbox.followUpNote": "Tala sa follow-up",
    "inbox.setReminder": "Magtakda ng paalala",
    "inbox.overdue": " · lampas na",
    "inbox.reopen": "Buksan muli",
    "inbox.done": "Tapos na",
    "inbox.assistant": "Assistant",
    "inbox.translatedFrom": "Isinalin mula sa {detectedlanguage}",
    "inbox.translation": "Salin",
    "inbox.hide": "Itago",
    "inbox.showTranslation": "Ipakita ang salin",
    "inbox.translate": "Isalin",
    "inbox.replyToConversation": "Sumagot sa usapan",
    "inbox.writeAReply": "Sumulat ng sagot…",
    "inbox.useAnApprovedTemplateTo":
      "Gumamit ng aprubadong template para muling buksan ang usapang ito sa WhatsApp…",
    "inbox.thisCustomerHasNotMessaged":
      "Hindi nagmensahe ang customer na ito sa nakaraang 24 oras. Kailangan ng WhatsApp ang aprubadong template bago ka makapagpadala ng karaniwang sagot.",
    "inbox.suggestReply": "Magmungkahi ng sagot",
    "inbox.send": "Ipadala",
    "inbox.sending": "Ipinapadala…",
    "inbox.notDelivered": "Hindi naihatid",
    "inbox.read": "Nabasa",
    "inbox.delivered": "Naihatid",
    "inbox.sent": "Naipadala",
    "inbox.sendingFrom": "Ipinapadala mula sa {number}",
    "inbox.sendingFromTo": "Ipinapadala mula sa {number} papunta sa {recipient}",
    "inbox.cannotSendYet": "Hindi pa maipapadala ang sagot na ito",
    "inbox.status.unconfirmed": "Hindi kumpirmado",
    "inbox.unconfirmedHint":
      "Hindi kinumpirma ng WhatsApp ang mensaheng ito. Tanungin muna ang customer bago ito ipadala muli.",
    "inbox.block.conversation_not_found": "Hindi nahanap ang usapan.",
    "inbox.block.no_number":
      "Walang WhatsApp number na nakakonekta sa workspace na ito. Maaaring magkonekta ang company admin sa Mga Integrasyon.",
    "inbox.block.number_missing":
      "Hindi na nakakonekta ang WhatsApp number ng usapang ito. Dapat itong ikonekta muli ng company admin sa Mga Integrasyon.",
    "inbox.block.number_disabled":
      "Naka-off sa Mga Integrasyon ang WhatsApp number ng usapang ito.",
    "inbox.block.number_needs_reconnect":
      "Nawalan ng koneksyon sa Meta ang WhatsApp number ng usapang ito. Dapat itong ikonekta muli ng company admin.",
    "inbox.block.workspace_suspended":
      "Suspendido ang workspace na ito — makipag-ugnayan sa iyong Flas account manager.",
    "inbox.block.subscription_inactive":
      "Hindi aktibo ang subscription ng workspace — nakahinto ang pagpapadala hangga't hindi aktibo ang plan.",
    "inbox.block.contact_not_saved":
      "Hindi naka-save ang numerong ito bilang contact na may naitalang pahintulot — kailangan ng WhatsApp ng pahintulot bago ang template na mensahe.",
    "inbox.block.no_consent":
      "Walang naitalang pahintulot para sa contact na ito — kailangan ng WhatsApp ng pahintulot bago ang template o marketing na mensahe.",
    "inbox.block.window_closed":
      "Sarado na ang 24-oras na reply window ng WhatsApp — magpadala ng aprubadong template para muling buksan ang usapan.",
    "inbox.block.routed_to_other_number":
      "Itinatalaga ng mga panuntunan sa routing ang lead na ito sa ibang WhatsApp number — sumagot mula sa linyang iyon.",
    "inbox.block.recipient_invalid":
      "Hindi kumpletong international na numero ang numero ng contact na ito. I-save ito sa international na anyo, halimbawa +971 50 123 4567.",
    "inbox.sendFailure.window_closed":
      "Sarado na ang 24-oras na reply window ng WhatsApp. Magpadala ng aprubadong template para muling buksan ang chat na ito.",
    "inbox.sendFailure.credentials":
      "Kailangang ikonekta muli ng company admin ang nakakonektang WhatsApp account.",
    "inbox.sendFailure.permission":
      "Kulang ang nakakonektang WhatsApp account ng pahintulot na kailangan ng mensaheng ito. Dapat itong ikonekta muli ng company admin at aprubahan ang bawat pahintulot.",
    "inbox.sendFailure.template":
      "Tinanggihan ng WhatsApp ang template na ito. Tiyaking aprubado ito sa wikang ito, hindi naka-pause, at napunan ang bawat variable.",
    "inbox.sendFailure.rate_limited":
      "Nililimitahan ngayon ng WhatsApp ang bilis ng pagpapadala ng numerong ito. Maghintay ng ilang minuto bago subukang muli.",
    "inbox.sendFailure.quality_restricted":
      "Nilimitahan ng WhatsApp ang numerong ito o ang mensaheng ito dahil sa mga limitasyon sa kalidad o patakaran. Tingnan ang status ng numero sa Meta bago magpadala pa.",
    "inbox.sendFailure.recipient_unreachable":
      "Hindi maabot ng WhatsApp ang numerong ito. Tiyaking gumagamit ng WhatsApp ang customer dito.",
    "inbox.sendFailure.recipient_not_allowed":
      "Nasa test mode pa ang WhatsApp account na ito at mga aprubadong test recipient lang ang mamemensahe nito.",
    "inbox.sendFailure.recipient_opted_out":
      "Nag-opt out ang customer na ito sa mga marketing na mensahe sa WhatsApp.",
    "inbox.sendFailure.number_not_registered":
      "Hindi pa rehistrado o aprubado sa WhatsApp ang numerong pang-negosyong ito. Dapat tapusin ng company admin ang setup nito sa Meta.",
    "inbox.sendFailure.billing":
      "Tinanggihan ng WhatsApp ang mensahe dahil sa problema sa bayad sa Meta business account.",
    "inbox.sendFailure.invalid_request":
      "Hindi tinanggap ng WhatsApp ang mensaheng ito ayon sa pagkakasulat. Tingnan ang numero ng customer at ang nilalaman ng mensahe.",
    "inbox.sendFailure.provider_unavailable":
      "Pansamantalang hindi available ang WhatsApp. Hindi naipadala ang mensahe; subukang muli maya-maya.",
    "inbox.sendFailure.unknown":
      "Hindi tinanggap ng WhatsApp ang mensaheng ito. Hilingin sa company admin na tingnan ang koneksyon.",
    "inbox.sendFailure.unconfirmed":
      "Hindi kinumpirma ng WhatsApp kung naipadala ang mensaheng ito. Huwag muna itong ipadala muli: tanungin ang customer, o hintayin ang delivery receipt.",
  },
  sw: {
    "inbox.messageBlockedBySafetyRules": "Ujumbe umezuiwa na kanuni za usalama",
    "inbox.savedButNotDelivered": "Imehifadhiwa, lakini haijafika: {deliveryError}",
    "inbox.followUpReminderSet": "Kikumbusho cha ufuatiliaji kimewekwa",
    "inbox.templateBlockedBySafetyRules": "Kiolezo kimezuiwa na kanuni za usalama",
    "inbox.templateAcceptedByWhatsappDelivery":
      "Kiolezo kimekubaliwa na WhatsApp. Uthibitisho wa kufika unasubiriwa.",
    "inbox.catalogMessageInsertedPressSend":
      "Ujumbe wa katalogi umewekwa — bonyeza Tuma ili kuutuma",
    "inbox.conversationsCsvDownloaded": "CSV ya mazungumzo imepakuliwa",
    "inbox.transcriptCsvDownloaded": "CSV ya nakala ya mazungumzo imepakuliwa",
    "inbox.inbox": "Kikasha",
    "inbox.liveLastUpdate": "Moja kwa moja · sasisho la mwisho {toLocaleTimeString}",
    "inbox.liveNewMessagesArriveInstantly": "Moja kwa moja — ujumbe mpya hufika papo hapo",
    "inbox.reconnectingCheckingForNewMessages":
      "Inaunganisha tena — inaangalia ujumbe mpya kila sekunde 10",
    "inbox.live": "Moja kwa moja",
    "inbox.connecting": "Inaunganisha",
    "inbox.polling": "Inakagua mara kwa mara",
    "inbox.downloadAllConversationsAsCsv": "Pakua mazungumzo yote kama CSV",
    "inbox.searchChats": "Tafuta mazungumzo",
    "inbox.searchConversations": "Tafuta mazungumzo",
    "inbox.loadingConversations": "Inapakia mazungumzo…",
    "inbox.noConversationsYetMessagesFrom":
      "Bado hakuna mazungumzo. Ujumbe kutoka WhatsApp na kifaa cha tovuti hufika hapa.",
    "inbox.unknown": "Haijulikani",
    "inbox.noMessagesYet": "Bado hakuna ujumbe",
    "inbox.website": "Tovuti",
    "inbox.bot": "Bot",
    "inbox.selectAConversationToStart": "Chagua mazungumzo ili uanze kufuatilia.",
    "inbox.backToConversations": "Rudi kwenye mazungumzo",
    "inbox.websiteVisitor": "Mgeni wa tovuti",
    "inbox.showMessageTools": "Onyesha zana za ujumbe",
    "inbox.tools": "Zana",
    "inbox.aiAutoReply": "Majibu ya kiotomatiki ya AI",
    "inbox.autoTranslateNewIncomingMessages": "Tafsiri kiotomatiki ujumbe mpya unaoingia",
    "inbox.autoTranslateNew": "Tafsiri mpya kiotomatiki",
    "inbox.downloadThisChatAsCsv": "Pakua mazungumzo haya kama CSV",
    "inbox.transcript": "Nakala",
    "inbox.unassigned": "Haijakabidhiwa",
    "inbox.me": "Mimi",
    "inbox.teammate": "Mwenzangu",
    "inbox.remove": "Ondoa {tag}",
    "inbox.addTag": "Ongeza lebo",
    "inbox.addConversationTag": "Ongeza lebo ya mazungumzo",
    "inbox.approvedWhatsappTemplate": "Kiolezo cha WhatsApp kilichoidhinishwa",
    "inbox.sendApprovedTemplate": "Tuma kiolezo kilichoidhinishwa…",
    "inbox.sendTemplate": "Tuma kiolezo",
    "inbox.personalizeYourTemplate": "Binafsisha kiolezo chako",
    "inbox.variable": "Kigeu {value}",
    "inbox.messagePreview": "Onyesho la awali la ujumbe",
    "inbox.reviewTheMessageBeforePressing": "Kagua ujumbe kabla ya kubonyeza Tuma kiolezo.",
    "inbox.searchProducts": "Tafuta bidhaa",
    "inbox.searchCatalogProducts": "Tafuta bidhaa za katalogi",
    "inbox.insertCatalogMessage": "Weka ujumbe wa katalogi",
    "inbox.noProductsInCatalogYet": "Bado hakuna bidhaa kwenye katalogi.",
    "inbox.followUpNote": "Dokezo la ufuatiliaji",
    "inbox.setReminder": "Weka kikumbusho",
    "inbox.overdue": " · imechelewa",
    "inbox.reopen": "Fungua tena",
    "inbox.done": "Imekamilika",
    "inbox.assistant": "Msaidizi",
    "inbox.translatedFrom": "Imetafsiriwa kutoka {detectedlanguage}",
    "inbox.translation": "Tafsiri",
    "inbox.hide": "Ficha",
    "inbox.showTranslation": "Onyesha tafsiri",
    "inbox.translate": "Tafsiri",
    "inbox.replyToConversation": "Jibu mazungumzo",
    "inbox.writeAReply": "Andika jibu…",
    "inbox.useAnApprovedTemplateTo":
      "Tumia kiolezo kilichoidhinishwa kufungua tena mazungumzo haya ya WhatsApp…",
    "inbox.thisCustomerHasNotMessaged":
      "Mteja huyu hajatuma ujumbe katika saa 24 zilizopita. WhatsApp inahitaji kiolezo kilichoidhinishwa kabla ya kutuma jibu la kawaida.",
    "inbox.suggestReply": "Pendekeza jibu",
    "inbox.send": "Tuma",
    "inbox.sending": "Inatuma…",
    "inbox.notDelivered": "Haijafika",
    "inbox.read": "Imesomwa",
    "inbox.delivered": "Imefika",
    "inbox.sent": "Imetumwa",
    "inbox.sendingFrom": "Inatumwa kutoka {number}",
    "inbox.sendingFromTo": "Inatumwa kutoka {number} kwenda {recipient}",
    "inbox.cannotSendYet": "Jibu hili bado haliwezi kutumwa",
    "inbox.status.unconfirmed": "Haijathibitishwa",
    "inbox.unconfirmedHint":
      "WhatsApp haikuthibitisha ujumbe huu. Wasiliana na mteja kabla ya kuutuma tena.",
    "inbox.block.conversation_not_found": "Mazungumzo hayajapatikana.",
    "inbox.block.no_number":
      "Hakuna namba ya WhatsApp iliyounganishwa na eneo hili la kazi. Msimamizi wa kampuni anaweza kuunganisha moja kwenye Miunganisho.",
    "inbox.block.number_missing":
      "Namba ya WhatsApp ya mazungumzo haya haijaunganishwa tena. Msimamizi wa kampuni lazima aiunganishe upya kwenye Miunganisho.",
    "inbox.block.number_disabled":
      "Namba ya WhatsApp ya mazungumzo haya imezimwa kwenye Miunganisho.",
    "inbox.block.number_needs_reconnect":
      "Namba ya WhatsApp ya mazungumzo haya imepoteza muunganisho wake na Meta. Msimamizi wa kampuni lazima aiunganishe upya.",
    "inbox.block.workspace_suspended":
      "Eneo hili la kazi limesimamishwa — wasiliana na meneja wako wa akaunti wa Flas.",
    "inbox.block.subscription_inactive":
      "Usajili wa eneo la kazi si hai — utumaji umesitishwa hadi mpango uwe hai.",
    "inbox.block.contact_not_saved":
      "Namba hii haijahifadhiwa kama anwani yenye idhini iliyorekodiwa — WhatsApp inahitaji idhini kabla ya ujumbe wa kiolezo.",
    "inbox.block.no_consent":
      "Hakuna idhini iliyorekodiwa kwa anwani hii — WhatsApp inahitaji idhini kabla ya ujumbe wa kiolezo au wa masoko.",
    "inbox.block.window_closed":
      "Dirisha la saa 24 la kujibu la WhatsApp limefungwa — tuma kiolezo kilichoidhinishwa ili kufungua tena mazungumzo.",
    "inbox.block.routed_to_other_number":
      "Kanuni za uelekezaji zinamkabidhi mteja huyu mtarajiwa kwa namba nyingine ya WhatsApp — jibu kutoka laini hiyo.",
    "inbox.block.recipient_invalid":
      "Namba ya anwani hii si namba kamili ya kimataifa. Ihifadhi kwa mfumo wa kimataifa, kwa mfano +971 50 123 4567.",
    "inbox.sendFailure.window_closed":
      "Dirisha la saa 24 la kujibu la WhatsApp limefungwa. Tuma kiolezo kilichoidhinishwa ili kufungua tena gumzo hili.",
    "inbox.sendFailure.credentials":
      "Akaunti ya WhatsApp iliyounganishwa inahitaji kuunganishwa upya na msimamizi wa kampuni.",
    "inbox.sendFailure.permission":
      "Akaunti ya WhatsApp iliyounganishwa haina ruhusa ambayo ujumbe huu unahitaji. Msimamizi wa kampuni lazima aiunganishe upya na aidhinishe kila ruhusa.",
    "inbox.sendFailure.template":
      "WhatsApp imekataa kiolezo hiki. Hakikisha kimeidhinishwa kwa lugha hii, hakijasitishwa, na kila kigezo kimejazwa.",
    "inbox.sendFailure.rate_limited":
      "WhatsApp inapunguza kasi ya utumaji wa namba hii kwa sasa. Subiri dakika chache kabla ya kujaribu tena.",
    "inbox.sendFailure.quality_restricted":
      "WhatsApp imeweka vikwazo kwa namba hii au ujumbe huu kwa sababu ya mipaka ya ubora au sera. Angalia hali ya namba kwenye Meta kabla ya kutuma zaidi.",
    "inbox.sendFailure.recipient_unreachable":
      "WhatsApp haikuweza kufikia namba hii. Hakikisha mteja anatumia WhatsApp kwenye namba hii.",
    "inbox.sendFailure.recipient_not_allowed":
      "Akaunti hii ya WhatsApp bado iko katika hali ya majaribio na inaweza kuwatumia ujumbe wapokeaji wa majaribio walioidhinishwa pekee.",
    "inbox.sendFailure.recipient_opted_out":
      "Mteja huyu amejiondoa kwenye ujumbe wa masoko kwenye WhatsApp.",
    "inbox.sendFailure.number_not_registered":
      "Namba hii ya biashara bado haijasajiliwa au kuidhinishwa kwenye WhatsApp. Msimamizi wa kampuni lazima akamilishe usanidi wake kwenye Meta.",
    "inbox.sendFailure.billing":
      "WhatsApp imekataa ujumbe kwa sababu ya tatizo la malipo kwenye akaunti ya biashara ya Meta.",
    "inbox.sendFailure.invalid_request":
      "WhatsApp haikukubali ujumbe huu kama ulivyoandikwa. Angalia namba ya mteja na maudhui ya ujumbe.",
    "inbox.sendFailure.provider_unavailable":
      "WhatsApp haipatikani kwa muda. Ujumbe haukutumwa; jaribu tena baada ya muda mfupi.",
    "inbox.sendFailure.unknown":
      "WhatsApp haikukubali ujumbe huu. Mwombe msimamizi wa kampuni akague muunganisho.",
    "inbox.sendFailure.unconfirmed":
      "WhatsApp haikuthibitisha kama ujumbe huu ulitumwa. Usiutume tena bado: wasiliana na mteja, au subiri risiti ya uwasilishaji.",
  },
});
