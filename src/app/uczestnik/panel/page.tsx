import { ParticipantProgram } from "@/components/participant-program";
import Image from "next/image";
import Link from "next/link";
import { participantSurvey } from "@/server/surveys";
import { TrainingCarousel } from "@/components/training-carousel";
import { ConferenceShell } from "@/components/conference-shell";
import styles from "./panel.module.css";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attendance, events, materials } from "@/db/schema";
import { requireParticipant } from "@/server/auth";
import { certificateAvailable } from "@/server/attendance";
import { participantCourses } from "@/server/training";
import { AppError } from "@/server/errors";
import {
  CertificateRefresh,
  ParticipantActions,
  ParticipantLogout,
} from "@/components/participant";
export const metadata = { title: "Twoja strefa | Głowa do Góry" };
export const dynamic = "force-dynamic";
export default async function Page() {
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
  const [[event], [present]] = await Promise.all([
    db().select().from(events).where(eq(events.id, person.eventId)),
    db()
      .select()
      .from(attendance)
      .where(eq(attendance.participantId, person.id)),
  ]);
  const courses = present ? await participantCourses(person.id) : [];
  const survey = await participantSurvey(person);
  const ready = !!present && certificateAvailable(event);
  const files = present
    ? await db()
        .select({ id: materials.id, title: materials.title })
        .from(materials)
        .where(eq(materials.eventId, event.id))
    : [];
  const unlockedAt = new Date(
    Math.max(event.endsAt.getTime(), event.certificateUnlockAt.getTime()),
  );
  const dateTime = new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: event.timezone,
  });
  return (
    <ConferenceShell current="participant">
      <div className={styles.panel}>
        <header className={styles.welcome}>
          <div className={styles.topline}>
            <span>Konferencja Głowa do Góry</span>
            <ParticipantLogout />
          </div>
          <div className={styles.titleRow}>
            <h1>
              Twoja
              <br />
              strefa<span>.</span>
            </h1>
            <Image
              src="/branding/g2g-vertical.png"
              alt="Logo projektu g2g"
              width={1024}
              height={1536}
              className={styles.logo}
            />
          </div>
          <p className={styles.greeting}>Cześć, {person.firstName}!</p>
        </header>
        <section
          className={`${styles.card} ${styles.community}`}
          aria-labelledby="community-title"
        >
          <div className={styles.communityBadge}>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M20.5 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.2-4.6a8.5 8.5 0 1 1 16.3-3.9Z" />
              <path d="M8 7.5c-.9.8-.4 3.2 1.7 5.3s4.5 2.6 5.3 1.7l1-1-2.5-1.4-.9.8a7 7 0 0 1-2.5-2.5l.8-.9L9.5 7Z" />
            </svg>
            Nasza grupa na WhatsApp
          </div>
          <h2 id="community-title">Dołącz do społeczności</h2>
          <p>
            Nie kończmy na konferencji! Dołącz do naszej grupy i bądźmy w
            kontakcie także po wydarzeniu.
          </p>
          <div className={styles.communityBenefits}>
            <span>Zdjęcia z konferencji</span>
            <span>Ciekawostki i inspiracje</span>
          </div>
          <a
            className={styles.communityAction}
            href="https://chat.whatsapp.com/JnhVyoBpCEi4N9bpuDds6D"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>Kliknij i dołącz do grupy</span>
            <span className={styles.communityArrow} aria-hidden="true">
              ↗
            </span>
          </a>
          <p className={styles.communityHint}>
            Otworzy się zaproszenie do grupy na WhatsApp.
          </p>
        </section>
        {!!present && !ready && (
          <CertificateRefresh unlockAt={unlockedAt.toISOString()} />
        )}
        {survey.published && !survey.available && (
          <CertificateRefresh unlockAt={survey.unlockAt} />
        )}
        <nav
          className={styles.navigation}
          aria-label="Sekcje strefy uczestnika"
        >
          <a href="#program">
            <span>01</span>Program
          </a>
          <a href="#szkolenia">
            <span>02</span>Szkolenia
          </a>
          {ready && (
            <a href="#certyfikat">
              <span>03</span>Certyfikat
            </a>
          )}
          {survey.available && (
            <a href="#ankieta">
              <span>04</span>Ankieta
            </a>
          )}
        </nav>

        <section
          id="program"
          className={styles.card}
          aria-labelledby="program-title"
        >
          <div className={styles.sectionLabel}>01 / Spotykamy się</div>
          <h2 id="program-title">Program</h2>
          <p className={styles.eventName}>{event.name}</p>
          <p className={styles.detail}>
            {dateTime.format(event.startsAt)}
            <br />
            {event.location}
          </p>
          {event.agenda.length ? (
            <ParticipantProgram
              items={event.agenda}
              startsAt={event.startsAt.toISOString()}
              timezone={event.timezone}
              initialNow={new Date().toISOString()}
            />
          ) : (
            <p className={styles.notice}>
              Szczegółowy program pojawi się wkrótce.
            </p>
          )}
          {event.info && <p className={styles.info}>{event.info}</p>}
        </section>

        <section
          id="szkolenia"
          className={styles.card}
          aria-labelledby="training-title"
        >
          <div className={styles.sectionLabel}>02 / Rozwijaj się dalej</div>
          <h2 id="training-title">Dostęp do szkoleń</h2>
          {!present ? (
            <p className={styles.notice}>
              Pokaż kod QR z zaproszenia przy wejściu. Po potwierdzeniu
              obecności otrzymasz dostęp do szkoleń i materiałów.
            </p>
          ) : (
            <>
              {courses.length ? (
                <TrainingCarousel>
                  {courses.map((course) => (
                    <article className={styles.course} key={course.id}>
                      <span className={styles.platform}>{course.platform}</span>
                      <h3>{course.name}</h3>
                      {course.available ? (
                        <>
                          {course.code && (
                            <div className={styles.code}>
                              <span>Twój kod dostępu</span>
                              <code>{course.code}</code>
                            </div>
                          )}
                          <a
                            className={styles.action}
                            href={course.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Przejdź do kursu <span aria-hidden="true">↗</span>
                          </a>
                        </>
                      ) : (
                        <p className={styles.notice}>
                          Organizator uzupełnia kody do tego szkolenia. Sprawdź
                          ponownie później.
                        </p>
                      )}
                    </article>
                  ))}
                </TrainingCarousel>
              ) : (
                <p className={styles.notice}>
                  Organizator przygotowuje szkolenia.
                </p>
              )}
              {files.length > 0 && (
                <div className={styles.materials}>
                  <h3>Materiały konferencyjne</h3>
                  {files.map((file) => (
                    <a
                      key={file.id}
                      href={`/api/participant/materials/${file.id}`}
                      download
                    >
                      {file.title}
                      <span>PDF ↓</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {survey.available && (
          <section
            id="ankieta"
            className={styles.card}
            aria-labelledby="survey-title"
          >
            <div className={styles.sectionLabel}>
              04 / Twoja opinia ma znaczenie
            </div>
            <h2 id="survey-title">Ankieta</h2>
            <p>
              {survey.submittedAt
                ? "Dziękujemy! Twoje odpowiedzi zostały zapisane."
                : "Podziel się swoją opinią i pomóż nam przygotować kolejne spotkania."}
            </p>
            {!survey.submittedAt && (
              <Link className={styles.action} href="/ankieta">
                Wypełnij ankietę →
              </Link>
            )}
          </section>
        )}
        {ready && (
          <section
            id="certyfikat"
            className={styles.card}
            aria-labelledby="certificate-title"
          >
            <div className={styles.sectionLabel}>
              03 / Twój udział ma znaczenie
            </div>
            <h2 id="certificate-title">Certyfikat</h2>
            <p>Twój imienny certyfikat udziału w konferencji już czeka.</p>
            <ParticipantActions certificateReady={ready} />
          </section>
        )}
      </div>
    </ConferenceShell>
  );
}
