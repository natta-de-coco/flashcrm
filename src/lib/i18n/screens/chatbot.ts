// Text for the "chatbot" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "chatbot.chatbotSavedButAutoReply":
      "Chatbot saved, but auto-reply will remain paused until instructions (min 20 characters) and a greeting are provided.",
    "chatbot.chatbotUpdated": "Chatbot updated",
    "chatbot.aiChatbot": "AI chatbot",
    "chatbot.theAssistantAnswersWhatsappAnd":
      "The assistant answers WhatsApp and website chats automatically, then hands off to a human when needed.",
    "chatbot.autoReply": "Auto-reply",
    "chatbot.dormant": "Dormant",
    "chatbot.active": "Active",
    "chatbot.replyInstantlyToNewIncoming": "Reply instantly to new incoming messages.",
    "chatbot.autoReplyIsDormant": "Auto-reply is dormant",
    "chatbot.evenThoughTheAutoReply":
      "Even though the auto-reply switch is turned on, your assistant will not reply to incoming chats until configuration requirements are met:",
    "chatbot.instructionsMustBeAtLeast":
      "Instructions must be at least 20 characters (currently {length}).",
    "chatbot.aFirstGreetingMessageIs": "A first greeting message is required.",
    "chatbot.personality": "Personality",
    "chatbot.botName": "Bot name",
    "chatbot.firstGreeting": "First greeting",
    "chatbot.requiredForAutoReply": "Required for auto-reply",
    "chatbot.eGHiThereThanks":
      "e.g. Hi there! Thanks for contacting us. How can we help you today?",
    "chatbot.instructionsKnowledge": "Instructions / knowledge",
    "chatbot.20MinChars": "{length} / 20 min chars",
    "chatbot.tellUsWhatYouSell":
      "Tell us what you sell, how delivery works, and anything your team should know. Replies are warm and casual by default.",
    "chatbot.model": "Model",
    "chatbot.catalog": "catalog",
    "chatbot.customerRepliesUseFlasAi":
      "Customer replies use FLAS AI. If it is unavailable, the conversation goes to your team. Replies use up to 50 products from your {link}. Keep product details and prices current. This is not a WhatsApp shopping catalog sync.",
    "chatbot.humanHandoff": "Human handoff",
    "chatbot.requestsForAPersonAnd":
      "Requests for a person and uncertain answers pause the bot and put the chat in your team’s queue. Add any extra words below.",
    "chatbot.handoffKeywordsCommaSeparated": "Handoff keywords (comma separated)",
    "chatbot.humanAgentComplaintRefund": "human, agent, complaint, refund",
    "chatbot.availabilityBasedSchedulingComingSoon": "Availability-based scheduling — coming soon",
    "chatbot.saveChatbot": "Save chatbot",
    "chatbot.turnOnAutomaticReplies": "Turn on automatic replies?",
    "chatbot.turnOnAutomaticRepliesBody":
      "The assistant will reply to customers on its own, using the instructions on this page. A person can take over any conversation at any time, and the assistant stops answering in that conversation when they do. Nothing changes until you save this page.",
    "chatbot.turnOn": "Turn on",
    "chatbot.notNow": "Not now",
    "chatbot.answerNewConversations": "Answer new conversations automatically",
    "chatbot.answerNewConversationsHint":
      "On: every new conversation starts with the assistant answering. Off: the assistant answers only in conversations where someone has switched it on in the Inbox.",
    "chatbot.automationLastChanged": "Automatic replies were last changed on {date}.",
  },
  ar: {
    "chatbot.chatbotSavedButAutoReply":
      "حُفظ روبوت المحادثة، لكن الرد التلقائي سيبقى متوقفًا حتى تُضاف التعليمات (20 حرفًا على الأقل) ورسالة ترحيب.",
    "chatbot.chatbotUpdated": "حُدّث روبوت المحادثة",
    "chatbot.aiChatbot": "روبوت محادثة بالذكاء الاصطناعي",
    "chatbot.theAssistantAnswersWhatsappAnd":
      "يرد المساعد على محادثات واتساب والموقع تلقائيًا، ثم يحوّلها إلى موظف عند الحاجة.",
    "chatbot.autoReply": "الرد التلقائي",
    "chatbot.dormant": "خامل",
    "chatbot.active": "نشط",
    "chatbot.replyInstantlyToNewIncoming": "الرد فورًا على الرسائل الواردة الجديدة.",
    "chatbot.autoReplyIsDormant": "الرد التلقائي خامل",
    "chatbot.evenThoughTheAutoReply":
      "مع أن مفتاح الرد التلقائي مفعّل، لن يرد مساعدك على المحادثات الواردة حتى تُستوفى متطلبات الإعداد:",
    "chatbot.instructionsMustBeAtLeast": "يجب ألا تقل التعليمات عن 20 حرفًا (حاليًا {length}).",
    "chatbot.aFirstGreetingMessageIs": "رسالة الترحيب الأولى مطلوبة.",
    "chatbot.personality": "الشخصية",
    "chatbot.botName": "اسم الروبوت",
    "chatbot.firstGreeting": "الترحيب الأول",
    "chatbot.requiredForAutoReply": "مطلوب للرد التلقائي",
    "chatbot.eGHiThereThanks": "مثال: مرحبًا! شكرًا لتواصلك معنا. كيف يمكننا مساعدتك اليوم؟",
    "chatbot.instructionsKnowledge": "التعليمات / المعرفة",
    "chatbot.20MinChars": "{length} / 20 حرفًا على الأقل",
    "chatbot.tellUsWhatYouSell":
      "أخبرنا بما تبيعه، وكيف يتم التوصيل، وأي شيء ينبغي أن يعرفه فريقك. الردود ودّية وغير رسمية افتراضيًا.",
    "chatbot.model": "النموذج",
    "chatbot.catalog": "الكتالوج",
    "chatbot.customerRepliesUseFlasAi":
      "تستخدم ردود العملاء FLAS AI. إن لم يكن متاحًا، تنتقل المحادثة إلى فريقك. تستعين الردود بما يصل إلى 50 منتجًا من {link}. حافظ على تحديث تفاصيل المنتجات وأسعارها. هذه ليست مزامنة لكتالوج التسوق في واتساب.",
    "chatbot.humanHandoff": "التحويل إلى موظف",
    "chatbot.requestsForAPersonAnd":
      "طلبات التحدث إلى شخص والإجابات غير المؤكدة توقف الروبوت وتضع المحادثة في قائمة انتظار فريقك. أضف أي كلمات إضافية أدناه.",
    "chatbot.handoffKeywordsCommaSeparated": "كلمات التحويل (مفصولة بفواصل)",
    "chatbot.humanAgentComplaintRefund": "موظف، مندوب، شكوى، استرداد",
    "chatbot.availabilityBasedSchedulingComingSoon": "الجدولة حسب أوقات التوفر — قريبًا",
    "chatbot.saveChatbot": "حفظ روبوت المحادثة",
    "chatbot.turnOnAutomaticReplies": "تشغيل الردود التلقائية؟",
    "chatbot.turnOnAutomaticRepliesBody":
      "سيرد المساعد على العملاء من تلقاء نفسه وفق التعليمات في هذه الصفحة. يمكن لأي شخص تولّي أي محادثة في أي وقت، ويتوقف المساعد عن الرد في تلك المحادثة عند ذلك. لا يتغير شيء حتى تحفظ هذه الصفحة.",
    "chatbot.turnOn": "تشغيل",
    "chatbot.notNow": "ليس الآن",
    "chatbot.answerNewConversations": "الرد على المحادثات الجديدة تلقائيًا",
    "chatbot.answerNewConversationsHint":
      "عند التشغيل: تبدأ كل محادثة جديدة والمساعد يرد فيها. عند الإيقاف: يرد المساعد فقط في المحادثات التي فعّله فيها أحدهم من صندوق الوارد.",
    "chatbot.automationLastChanged": "آخر تغيير للردود التلقائية كان في {date}.",
  },
  ms: {
    "chatbot.chatbotSavedButAutoReply":
      "Chatbot disimpan, tetapi balasan automatik akan kekal dijeda sehingga arahan (minimum 20 aksara) dan ucapan disediakan.",
    "chatbot.chatbotUpdated": "Chatbot dikemas kini",
    "chatbot.aiChatbot": "Chatbot AI",
    "chatbot.theAssistantAnswersWhatsappAnd":
      "Pembantu menjawab sembang WhatsApp dan laman web secara automatik, kemudian menyerahkannya kepada manusia apabila perlu.",
    "chatbot.autoReply": "Balasan automatik",
    "chatbot.dormant": "Tidak aktif",
    "chatbot.active": "Aktif",
    "chatbot.replyInstantlyToNewIncoming": "Balas serta-merta kepada mesej masuk baharu.",
    "chatbot.autoReplyIsDormant": "Balasan automatik tidak aktif",
    "chatbot.evenThoughTheAutoReply":
      "Walaupun suis balasan automatik dihidupkan, pembantu anda tidak akan membalas sembang masuk sehingga keperluan konfigurasi dipenuhi:",
    "chatbot.instructionsMustBeAtLeast":
      "Arahan mestilah sekurang-kurangnya 20 aksara (kini {length}).",
    "chatbot.aFirstGreetingMessageIs": "Mesej ucapan pertama diperlukan.",
    "chatbot.personality": "Personaliti",
    "chatbot.botName": "Nama bot",
    "chatbot.firstGreeting": "Ucapan pertama",
    "chatbot.requiredForAutoReply": "Diperlukan untuk balasan automatik",
    "chatbot.eGHiThereThanks":
      "cth. Hai! Terima kasih kerana menghubungi kami. Bagaimana kami boleh membantu anda hari ini?",
    "chatbot.instructionsKnowledge": "Arahan / pengetahuan",
    "chatbot.20MinChars": "{length} / minimum 20 aksara",
    "chatbot.tellUsWhatYouSell":
      "Beritahu kami apa yang anda jual, cara penghantaran berfungsi, dan apa-apa yang pasukan anda perlu tahu. Balasan secara lalai mesra dan santai.",
    "chatbot.model": "Model",
    "chatbot.catalog": "katalog",
    "chatbot.customerRepliesUseFlasAi":
      "Balasan pelanggan menggunakan FLAS AI. Jika tidak tersedia, perbualan beralih kepada pasukan anda. Balasan menggunakan sehingga 50 produk daripada {link} anda. Pastikan butiran dan harga produk terkini. Ini bukan penyegerakan katalog beli-belah WhatsApp.",
    "chatbot.humanHandoff": "Serahan kepada manusia",
    "chatbot.requestsForAPersonAnd":
      "Permintaan untuk bercakap dengan orang dan jawapan yang tidak pasti menjeda bot dan meletakkan sembang dalam giliran pasukan anda. Tambah sebarang perkataan tambahan di bawah.",
    "chatbot.handoffKeywordsCommaSeparated": "Kata kunci serahan (dipisahkan koma)",
    "chatbot.humanAgentComplaintRefund": "manusia, ejen, aduan, bayaran balik",
    "chatbot.availabilityBasedSchedulingComingSoon":
      "Penjadualan berdasarkan ketersediaan — akan datang",
    "chatbot.saveChatbot": "Simpan chatbot",
    "chatbot.turnOnAutomaticReplies": "Hidupkan balasan automatik?",
    "chatbot.turnOnAutomaticRepliesBody":
      "Pembantu akan membalas pelanggan dengan sendirinya, menggunakan arahan di halaman ini. Seseorang boleh mengambil alih mana-mana perbualan pada bila-bila masa, dan pembantu berhenti membalas dalam perbualan itu apabila mereka berbuat demikian. Tiada apa yang berubah sehingga anda menyimpan halaman ini.",
    "chatbot.turnOn": "Hidupkan",
    "chatbot.notNow": "Bukan sekarang",
    "chatbot.answerNewConversations": "Jawab perbualan baharu secara automatik",
    "chatbot.answerNewConversationsHint":
      "Hidup: setiap perbualan baharu bermula dengan pembantu menjawab. Mati: pembantu hanya menjawab dalam perbualan yang seseorang telah menghidupkannya di Peti Masuk.",
    "chatbot.automationLastChanged": "Balasan automatik terakhir diubah pada {date}.",
  },
  fil: {
    "chatbot.chatbotSavedButAutoReply":
      "Na-save ang chatbot, pero mananatiling naka-pause ang auto-reply hangga't walang mga tagubilin (hindi bababa sa 20 character) at pambungad na mensahe.",
    "chatbot.chatbotUpdated": "Na-update ang chatbot",
    "chatbot.aiChatbot": "AI chatbot",
    "chatbot.theAssistantAnswersWhatsappAnd":
      "Awtomatikong sinasagot ng assistant ang mga chat sa WhatsApp at website, saka ipinapasa sa tao kapag kailangan.",
    "chatbot.autoReply": "Auto-reply",
    "chatbot.dormant": "Nakahinto",
    "chatbot.active": "Aktibo",
    "chatbot.replyInstantlyToNewIncoming": "Sumagot agad sa mga bagong papasok na mensahe.",
    "chatbot.autoReplyIsDormant": "Nakahinto ang auto-reply",
    "chatbot.evenThoughTheAutoReply":
      "Kahit naka-on ang auto-reply, hindi sasagot ang iyong assistant sa mga papasok na chat hangga't hindi natutugunan ang mga kinakailangan sa setup:",
    "chatbot.instructionsMustBeAtLeast":
      "Dapat hindi bababa sa 20 character ang mga tagubilin (kasalukuyang {length}).",
    "chatbot.aFirstGreetingMessageIs": "Kailangan ang unang pambungad na mensahe.",
    "chatbot.personality": "Personalidad",
    "chatbot.botName": "Pangalan ng bot",
    "chatbot.firstGreeting": "Unang pagbati",
    "chatbot.requiredForAutoReply": "Kailangan para sa auto-reply",
    "chatbot.eGHiThereThanks":
      "hal. Kumusta! Salamat sa pakikipag-ugnayan. Paano ka namin matutulungan ngayon?",
    "chatbot.instructionsKnowledge": "Mga tagubilin / kaalaman",
    "chatbot.20MinChars": "{length} / min. 20 character",
    "chatbot.tellUsWhatYouSell":
      "Sabihin sa amin kung ano ang ibinebenta mo, paano ang delivery, at anumang dapat malaman ng iyong team. Magiliw at kaswal ang mga sagot bilang default.",
    "chatbot.model": "Modelo",
    "chatbot.catalog": "catalog",
    "chatbot.customerRepliesUseFlasAi":
      "Gumagamit ng FLAS AI ang mga sagot sa customer. Kapag hindi ito available, mapupunta ang usapan sa iyong team. Gumagamit ang mga sagot ng hanggang 50 produkto mula sa iyong {link}. Panatilihing updated ang detalye at presyo ng produkto. Hindi ito sync ng WhatsApp shopping catalog.",
    "chatbot.humanHandoff": "Pagpasa sa tao",
    "chatbot.requestsForAPersonAnd":
      "Ang mga hiling na makausap ang tao at mga hindi siguradong sagot ay nagpapahinto sa bot at inilalagay ang chat sa pila ng iyong team. Magdagdag ng iba pang salita sa ibaba.",
    "chatbot.handoffKeywordsCommaSeparated": "Mga keyword sa pagpasa (pinaghihiwalay ng kuwit)",
    "chatbot.humanAgentComplaintRefund": "tao, agent, reklamo, refund",
    "chatbot.availabilityBasedSchedulingComingSoon":
      "Pag-iskedyul batay sa availability — malapit na",
    "chatbot.saveChatbot": "I-save ang chatbot",
    "chatbot.turnOnAutomaticReplies": "I-on ang mga awtomatikong sagot?",
    "chatbot.turnOnAutomaticRepliesBody":
      "Sasagot ang assistant sa mga customer nang mag-isa, gamit ang mga tagubilin sa pahinang ito. Maaaring akuin ng isang tao ang anumang usapan anumang oras, at titigil ang assistant sa pagsagot sa usapang iyon kapag ginawa nila ito. Walang magbabago hanggang i-save mo ang pahinang ito.",
    "chatbot.turnOn": "I-on",
    "chatbot.notNow": "Hindi muna",
    "chatbot.answerNewConversations": "Awtomatikong sagutin ang mga bagong usapan",
    "chatbot.answerNewConversationsHint":
      "Naka-on: nagsisimula ang bawat bagong usapan na sumasagot ang assistant. Naka-off: sumasagot lang ang assistant sa mga usapang may nag-on nito sa Inbox.",
    "chatbot.automationLastChanged": "Huling binago ang mga awtomatikong sagot noong {date}.",
  },
  sw: {
    "chatbot.chatbotSavedButAutoReply":
      "Chatbot imehifadhiwa, lakini majibu ya kiotomatiki yatabaki yamesitishwa hadi maagizo (angalau herufi 20) na salamu vitolewe.",
    "chatbot.chatbotUpdated": "Chatbot imesasishwa",
    "chatbot.aiChatbot": "Chatbot ya AI",
    "chatbot.theAssistantAnswersWhatsappAnd":
      "Msaidizi hujibu mazungumzo ya WhatsApp na tovuti kiotomatiki, kisha huyakabidhi kwa mtu inapohitajika.",
    "chatbot.autoReply": "Majibu ya kiotomatiki",
    "chatbot.dormant": "Imelala",
    "chatbot.active": "Inatumika",
    "chatbot.replyInstantlyToNewIncoming": "Jibu papo hapo ujumbe mpya unaoingia.",
    "chatbot.autoReplyIsDormant": "Majibu ya kiotomatiki yamelala",
    "chatbot.evenThoughTheAutoReply":
      "Ingawa swichi ya majibu ya kiotomatiki imewashwa, msaidizi wako hatajibu mazungumzo yanayoingia hadi mahitaji ya usanidi yatimizwe:",
    "chatbot.instructionsMustBeAtLeast":
      "Maagizo lazima yawe na angalau herufi 20 (sasa ni {length}).",
    "chatbot.aFirstGreetingMessageIs": "Ujumbe wa kwanza wa salamu unahitajika.",
    "chatbot.personality": "Haiba",
    "chatbot.botName": "Jina la bot",
    "chatbot.firstGreeting": "Salamu ya kwanza",
    "chatbot.requiredForAutoReply": "Inahitajika kwa majibu ya kiotomatiki",
    "chatbot.eGHiThereThanks":
      "k.m. Habari! Asante kwa kuwasiliana nasi. Tunaweza kukusaidiaje leo?",
    "chatbot.instructionsKnowledge": "Maagizo / maarifa",
    "chatbot.20MinChars": "{length} / angalau herufi 20",
    "chatbot.tellUsWhatYouSell":
      "Tuambie unachouza, jinsi usafirishaji unavyofanya kazi, na chochote ambacho timu yako inapaswa kujua. Majibu huwa ya kirafiki na ya kawaida kwa chaguo-msingi.",
    "chatbot.model": "Modeli",
    "chatbot.catalog": "katalogi",
    "chatbot.customerRepliesUseFlasAi":
      "Majibu kwa wateja hutumia FLAS AI. Isipopatikana, mazungumzo huenda kwa timu yako. Majibu hutumia hadi bidhaa 50 kutoka kwenye {link} yako. Hakikisha maelezo na bei za bidhaa ni za sasa. Huu si usawazishaji wa katalogi ya ununuzi ya WhatsApp.",
    "chatbot.humanHandoff": "Kukabidhi kwa mtu",
    "chatbot.requestsForAPersonAnd":
      "Maombi ya kuzungumza na mtu na majibu yasiyo na uhakika husitisha bot na kuweka mazungumzo kwenye foleni ya timu yako. Ongeza maneno ya ziada hapa chini.",
    "chatbot.handoffKeywordsCommaSeparated":
      "Maneno muhimu ya kukabidhi (yametenganishwa kwa koma)",
    "chatbot.humanAgentComplaintRefund": "mtu, wakala, malalamiko, marejesho",
    "chatbot.availabilityBasedSchedulingComingSoon":
      "Upangaji kulingana na upatikanaji — inakuja hivi karibuni",
    "chatbot.saveChatbot": "Hifadhi chatbot",
    "chatbot.turnOnAutomaticReplies": "Washa majibu ya kiotomatiki?",
    "chatbot.turnOnAutomaticRepliesBody":
      "Msaidizi atawajibu wateja peke yake, akitumia maagizo yaliyo kwenye ukurasa huu. Mtu anaweza kuchukua mazungumzo yoyote wakati wowote, na msaidizi huacha kujibu katika mazungumzo hayo anapofanya hivyo. Hakuna kinachobadilika hadi uhifadhi ukurasa huu.",
    "chatbot.turnOn": "Washa",
    "chatbot.notNow": "Si sasa",
    "chatbot.answerNewConversations": "Jibu mazungumzo mapya kiotomatiki",
    "chatbot.answerNewConversationsHint":
      "Imewashwa: kila mazungumzo mapya huanza msaidizi akijibu. Imezimwa: msaidizi hujibu tu katika mazungumzo ambayo mtu ameiwasha kwenye Kikasha.",
    "chatbot.automationLastChanged":
      "Majibu ya kiotomatiki yalibadilishwa mara ya mwisho tarehe {date}.",
  },
});
