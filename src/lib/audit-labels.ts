export function auditActionLabel(action: string) {
  const prefix = "PARTICIPANT_PRIVACY_ACK_";
  if (action.startsWith(prefix))
    return "Potwierdzenie klauzuli " + action.slice(prefix.length);
  const labels: Record<string, string> = {
    CHECKIN_QR: "Potwierdzenie obecności kodem QR",
    CHECKIN_MANUAL: "Ręczne potwierdzenie obecności",
    PARTICIPANTS_IMPORTED: "Import uczestników",
    PARTICIPANT_UPDATED: "Zmiana danych uczestnika",
    PARTICIPANT_DELETED: "Usunięcie uczestnika",
    EVENT_UPDATED: "Zmiana ustawień konferencji",
    EVENT_CREATED: "Utworzenie konferencji",
    EVENT_PERSONAL_DATA_DELETED: "Usunięcie danych po okresie przechowywania",
    COURSE_CREATED: "Dodanie szkolenia",
    COURSE_UPDATED: "Zmiana szkolenia",
    TRAINING_CODES_IMPORTED: "Import kodów szkoleniowych",
    TRAINING_CODE_ASSIGNED: "Przydzielenie kodu szkoleniowego",
    CERTIFICATE_GENERATED: "Wygenerowanie certyfikatu",
    SURVEY_UPDATED: "Zmiana ustawień ankiety",
    SURVEY_EXPORTED: "Eksport anonimowych odpowiedzi ankiety",
    MATERIAL_UPLOADED: "Dodanie materiału PDF",
    TICKETS_EXPORTED: "Eksport biletów PDF",
    PARTICIPANT_CODES_EXPORTED: "Eksport kodów uczestników",
    EMAIL_SENT: "Wysłanie wiadomości",
    EMAIL_CAMPAIGN_STARTED: "Uruchomienie wysyłki",
  };
  return labels[action] || action;
}
