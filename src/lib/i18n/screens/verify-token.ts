// Text for the "verifyToken" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "verifyToken.notVerified": "Not verified",
    "verifyToken.thisCodeDoesNotMatch":
      "This code does not match any document issued through Flas. Treat the document as unverified and contact the sender.",
    "verifyToken.genuineDocument": "Genuine document",
    "verifyToken.theSeller": "the seller",
    "verifyToken.issuedThroughFlasByAnd":
      "Issued through Flas by {value} and unchanged since it was finalised.",
    "verifyToken.type": "Type",
    "verifyToken.number": "Number",
    "verifyToken.verificationId": "Verification ID",
    "verifyToken.issued": "Issued",
    "verifyToken.amount": "Amount",
    "verifyToken.balance": "Balance",
    "verifyToken.status": "Status",
    "verifyToken.pdfFingerprint": "PDF fingerprint: {pdfhash}",
    "verifyToken.temporarilyUnavailable": "Verification is temporarily unavailable.",
    "verifyToken.noDocumentMatches": "No document matches this code.",
  },
  ar: {
    "verifyToken.notVerified": "غير موثَّق",
    "verifyToken.thisCodeDoesNotMatch":
      "هذا الرمز لا يطابق أي مستند صادر عبر Flas. اعتبر المستند غير موثَّق وتواصل مع المرسِل.",
    "verifyToken.genuineDocument": "مستند أصلي",
    "verifyToken.theSeller": "البائع",
    "verifyToken.issuedThroughFlasByAnd": "صدر عبر Flas من {value} ولم يتغير منذ اعتماده.",
    "verifyToken.type": "النوع",
    "verifyToken.number": "الرقم",
    "verifyToken.verificationId": "معرّف التحقق",
    "verifyToken.issued": "تاريخ الإصدار",
    "verifyToken.amount": "المبلغ",
    "verifyToken.balance": "الرصيد",
    "verifyToken.status": "الحالة",
    "verifyToken.pdfFingerprint": "بصمة ملف PDF: {pdfhash}",
    "verifyToken.temporarilyUnavailable": "التحقق غير متاح مؤقتًا.",
    "verifyToken.noDocumentMatches": "لا يوجد مستند يطابق هذا الرمز.",
  },
  ms: {
    "verifyToken.notVerified": "Tidak disahkan",
    "verifyToken.thisCodeDoesNotMatch":
      "Kod ini tidak sepadan dengan mana-mana dokumen yang dikeluarkan melalui Flas. Anggap dokumen ini tidak disahkan dan hubungi pengirim.",
    "verifyToken.genuineDocument": "Dokumen tulen",
    "verifyToken.theSeller": "penjual",
    "verifyToken.issuedThroughFlasByAnd":
      "Dikeluarkan melalui Flas oleh {value} dan tidak berubah sejak dimuktamadkan.",
    "verifyToken.type": "Jenis",
    "verifyToken.number": "Nombor",
    "verifyToken.verificationId": "ID pengesahan",
    "verifyToken.issued": "Dikeluarkan",
    "verifyToken.amount": "Jumlah",
    "verifyToken.balance": "Baki",
    "verifyToken.status": "Status",
    "verifyToken.pdfFingerprint": "Cap jari PDF: {pdfhash}",
    "verifyToken.temporarilyUnavailable": "Pengesahan tidak tersedia buat sementara waktu.",
    "verifyToken.noDocumentMatches": "Tiada dokumen sepadan dengan kod ini.",
  },
  fil: {
    "verifyToken.notVerified": "Hindi na-verify",
    "verifyToken.thisCodeDoesNotMatch":
      "Hindi tumutugma ang code na ito sa anumang dokumentong inisyu sa Flas. Ituring na hindi na-verify ang dokumento at kontakin ang nagpadala.",
    "verifyToken.genuineDocument": "Tunay na dokumento",
    "verifyToken.theSeller": "ang nagbenta",
    "verifyToken.issuedThroughFlasByAnd":
      "Inisyu sa Flas ng {value} at hindi nabago mula nang ma-finalize.",
    "verifyToken.type": "Uri",
    "verifyToken.number": "Numero",
    "verifyToken.verificationId": "Verification ID",
    "verifyToken.issued": "Inisyu",
    "verifyToken.amount": "Halaga",
    "verifyToken.balance": "Balanse",
    "verifyToken.status": "Status",
    "verifyToken.pdfFingerprint": "PDF fingerprint: {pdfhash}",
    "verifyToken.temporarilyUnavailable": "Pansamantalang hindi available ang pag-verify.",
    "verifyToken.noDocumentMatches": "Walang dokumentong tumutugma sa code na ito.",
  },
  sw: {
    "verifyToken.notVerified": "Haijathibitishwa",
    "verifyToken.thisCodeDoesNotMatch":
      "Msimbo huu haulingani na hati yoyote iliyotolewa kupitia Flas. Ichukulie hati kuwa haijathibitishwa na uwasiliane na mtumaji.",
    "verifyToken.genuineDocument": "Hati halisi",
    "verifyToken.theSeller": "muuzaji",
    "verifyToken.issuedThroughFlasByAnd":
      "Imetolewa kupitia Flas na {value} na haijabadilika tangu ilipokamilishwa.",
    "verifyToken.type": "Aina",
    "verifyToken.number": "Namba",
    "verifyToken.verificationId": "Kitambulisho cha uthibitishaji",
    "verifyToken.issued": "Imetolewa",
    "verifyToken.amount": "Kiasi",
    "verifyToken.balance": "Salio",
    "verifyToken.status": "Hali",
    "verifyToken.pdfFingerprint": "Alama ya PDF: {pdfhash}",
    "verifyToken.temporarilyUnavailable": "Uthibitishaji haupatikani kwa muda.",
    "verifyToken.noDocumentMatches": "Hakuna hati inayolingana na msimbo huu.",
  },
});
