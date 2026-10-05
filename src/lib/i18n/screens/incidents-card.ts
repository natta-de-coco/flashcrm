// Text for the "incidentsCard" screen, in every language. Extracted by
// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by
// Claude and want a native speaker's review.
import { screen } from "../define";

export default screen({
  en: {
    "incidentsCard.active": "{length} active",
    "incidentsCard.healthy": "Healthy",
    "incidentsCard.applicationIncidents": "Application incidents{badge}",
    "incidentsCard.activeMeansRecordedInThe":
      "Active means recorded in the last 24 hours. Repeated copies are grouped so one problem appears once. Only your own workspace is shown.",
    "incidentsCard.noIncidentsRecordedInThe": "No incidents recorded in the last 24 hours.",
    "incidentsCard.repeatedTimes": " · repeated {count} times",
    "incidentsCard.incidentIs": "incident is",
    "incidentsCard.incidentsAre": "incidents are",
    "incidentsCard.olderKeptInHistoryAnd":
      "{historicalCount} older {value} kept in history and do not count as active.",
    "incidentsCard.kind.frontend": "Frontend error",
    "incidentsCard.kind.server_action": "Server action failed",
    "incidentsCard.kind.blank_screen": "Blank screen",
    "incidentsCard.kind.network": "Network failure",
    "incidentsCard.kind.error_boundary": "Screen crashed",
  },
  ar: {
    "incidentsCard.active": "{length} نشطة",
    "incidentsCard.healthy": "سليم",
    "incidentsCard.applicationIncidents": "حوادث التطبيق{badge}",
    "incidentsCard.activeMeansRecordedInThe":
      "«نشطة» تعني أنها سُجّلت خلال آخر 24 ساعة. النسخ المتكررة تُجمع لتظهر المشكلة الواحدة مرة واحدة. تُعرض مساحة عملك فقط.",
    "incidentsCard.noIncidentsRecordedInThe": "لم تُسجَّل حوادث خلال آخر 24 ساعة.",
    "incidentsCard.repeatedTimes": " · تكررت {count} مرة",
    "incidentsCard.incidentIs": "حادثة أقدم محفوظة",
    "incidentsCard.incidentsAre": "حوادث أقدم محفوظة",
    "incidentsCard.olderKeptInHistoryAnd": "{historicalCount} {value} في السجل ولا تُحتسب نشطة.",
    "incidentsCard.kind.frontend": "خطأ في الواجهة",
    "incidentsCard.kind.server_action": "فشل إجراء على الخادم",
    "incidentsCard.kind.blank_screen": "شاشة فارغة",
    "incidentsCard.kind.network": "عطل في الشبكة",
    "incidentsCard.kind.error_boundary": "تعطلت الشاشة",
  },
  ms: {
    "incidentsCard.active": "{length} aktif",
    "incidentsCard.healthy": "Sihat",
    "incidentsCard.applicationIncidents": "Insiden aplikasi{badge}",
    "incidentsCard.activeMeansRecordedInThe":
      "Aktif bermaksud direkodkan dalam 24 jam terakhir. Salinan berulang dikumpulkan supaya satu masalah muncul sekali. Hanya ruang kerja anda sendiri dipaparkan.",
    "incidentsCard.noIncidentsRecordedInThe": "Tiada insiden direkodkan dalam 24 jam terakhir.",
    "incidentsCard.repeatedTimes": " · berulang {count} kali",
    "incidentsCard.incidentIs": "insiden lama disimpan",
    "incidentsCard.incidentsAre": "insiden lama disimpan",
    "incidentsCard.olderKeptInHistoryAnd":
      "{historicalCount} {value} dalam sejarah dan tidak dikira sebagai aktif.",
    "incidentsCard.kind.frontend": "Ralat antara muka",
    "incidentsCard.kind.server_action": "Tindakan pelayan gagal",
    "incidentsCard.kind.blank_screen": "Skrin kosong",
    "incidentsCard.kind.network": "Kegagalan rangkaian",
    "incidentsCard.kind.error_boundary": "Skrin ranap",
  },
  fil: {
    "incidentsCard.active": "{length} aktibo",
    "incidentsCard.healthy": "Maayos",
    "incidentsCard.applicationIncidents": "Mga insidente sa application{badge}",
    "incidentsCard.activeMeansRecordedInThe":
      "Ang aktibo ay nangangahulugang naitala sa huling 24 oras. Pinagsasama ang mga paulit-ulit na kopya para isang beses lang lumabas ang isang problema. Ang sarili mong workspace lang ang ipinapakita.",
    "incidentsCard.noIncidentsRecordedInThe": "Walang naitalang insidente sa huling 24 oras.",
    "incidentsCard.repeatedTimes": " · naulit nang {count} beses",
    "incidentsCard.incidentIs": "mas lumang insidente ang nakatago",
    "incidentsCard.incidentsAre": "mas lumang insidente ang nakatago",
    "incidentsCard.olderKeptInHistoryAnd":
      "{historicalCount} {value} sa history at hindi binibilang na aktibo.",
    "incidentsCard.kind.frontend": "Error sa frontend",
    "incidentsCard.kind.server_action": "Nabigo ang aksyon sa server",
    "incidentsCard.kind.blank_screen": "Blangkong screen",
    "incidentsCard.kind.network": "Pagpalya ng network",
    "incidentsCard.kind.error_boundary": "Nag-crash ang screen",
  },
  sw: {
    "incidentsCard.active": "{length} hai",
    "incidentsCard.healthy": "Salama",
    "incidentsCard.applicationIncidents": "Matukio ya programu{badge}",
    "incidentsCard.activeMeansRecordedInThe":
      "Hai inamaanisha limerekodiwa katika saa 24 zilizopita. Nakala zinazojirudia huwekwa pamoja ili tatizo moja lionekane mara moja. Ni eneo lako la kazi tu linaloonyeshwa.",
    "incidentsCard.noIncidentsRecordedInThe":
      "Hakuna matukio yaliyorekodiwa katika saa 24 zilizopita.",
    "incidentsCard.repeatedTimes": " · limejirudia mara {count}",
    "incidentsCard.incidentIs": "tukio la zamani limehifadhiwa",
    "incidentsCard.incidentsAre": "matukio ya zamani yamehifadhiwa",
    "incidentsCard.olderKeptInHistoryAnd":
      "{historicalCount} {value} kwenye historia na hayahesabiwi kuwa hai.",
    "incidentsCard.kind.frontend": "Hitilafu ya kiolesura",
    "incidentsCard.kind.server_action": "Kitendo cha seva kimeshindwa",
    "incidentsCard.kind.blank_screen": "Skrini tupu",
    "incidentsCard.kind.network": "Hitilafu ya mtandao",
    "incidentsCard.kind.error_boundary": "Skrini imeanguka",
  },
});
