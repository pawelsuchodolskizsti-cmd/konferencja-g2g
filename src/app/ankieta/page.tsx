import Link from "next/link";
import { isDemoParticipant } from "@/server/demo-participant";
import { redirect } from "next/navigation";
import { ConferenceShell } from "@/components/conference-shell";
import { SurveyForm } from "@/components/survey-form";
import { CertificateRefresh } from "@/components/participant";
import { requireAdmin, requireEvent, requireParticipant } from "@/server/auth";
import { AppError } from "@/server/errors";
import { participantSurvey } from "@/server/surveys";
import styles from "./survey.module.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ankieta | Głowa do Góry",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ podglad?: string }>;
}) {
  const requestedPreview = (await searchParams).podglad === "1";
  let person;
  try {
    person = await requireParticipant();
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.status === 401 || error.status === 403)
    )
      redirect("/uczestnik");
    throw error;
  }
  const demo = isDemoParticipant(person);
  const preview = demo || requestedPreview;
  if (requestedPreview && !demo) {
    const admin = await requireAdmin();
    await requireEvent(admin.id, person.eventId);
  }
  const survey = await participantSurvey(person);
  return (
    <ConferenceShell current="participant">
      <div className={styles.page}>
        <Link
          href={preview ? "/uczestnik/panel?podglad=1" : "/uczestnik/panel"}
        >
          ← Wróć do swojej strefy
        </Link>
        <h1>Ankieta</h1>
        {preview || survey.available || survey.submittedAt ? (
          <SurveyForm
            questions={survey.questions}
            submitted={!preview && !!survey.submittedAt}
            preview={preview}
          />
        ) : (
          <>
            <p>
              {survey.published
                ? "Ankieta będzie dostępna o 17:30 w dniu konferencji."
                : "Organizator przygotowuje ankietę."}
            </p>
            {survey.published && new Date() < new Date(survey.unlockAt) && (
              <CertificateRefresh unlockAt={survey.unlockAt} />
            )}
          </>
        )}
      </div>
    </ConferenceShell>
  );
}
