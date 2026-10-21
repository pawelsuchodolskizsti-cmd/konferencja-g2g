import { materialsUnlocked } from "@/server/material-access";
import { ParticipantMaterials } from "@/components/participant-materials";
import { ParticipantProgram } from "@/components/participant-program";
import { isDemoParticipant } from "@/server/demo-participant";
import Image from "next/image";
import QRCode from "qrcode";
import { decrypt } from "@/server/crypto";
import Link from "next/link";
import { participantSurvey } from "@/server/surveys";
import { TrainingCarousel } from "@/components/training-carousel";
import { ConferenceShell } from "@/components/conference-shell";
import styles from "./panel.module.css";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendance, events, materials } from "@/db/schema";
import { requireAdmin, requireEvent, requireParticipant } from "@/server/auth";
import { certificateAvailable } from "@/server/attendance";
import { participantCourses } from "@/server/training";
import { isOnMyWayCourse, onMyWayArtwork } from "@/server/training-artwork";
import { AppError } from "@/server/errors";
import {
  CertificateRefresh,
  CheckinRefresh,
  ParticipantLogout,
} from "@/components/participant";
export const metadata = { title: "Twoja strefa | Głowa do Góry" };
export const dynamic = "force-dynamic";
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
  const [[event], [present]] = await Promise.all([
    db().select().from(events).where(eq(events.id, person.eventId)),
    db()
      .select()
      .from(attendance)
      .where(eq(attendance.participantId, person.id)),
  ]);
  const courses =
    preview && !!present && event.coursesUnlocked
      ? [
          {
            id: "preview",
            name: "On my way - 2 miesiące dostępu",
            platform: "Joanna Chmura",
            url: "https://onmyway.pl/",
            code: "ONEDAY",
            available: true,
          },
          {
            id: "preview-2",
            name: "Przykładowe szkolenie 2",
            platform: "Platforma szkoleniowa",
            url: "#szkolenia",
            code: "G2G-TEST-02",
            available: true,
          },
        ]
      : present && event.coursesUnlocked
        ? await participantCourses(person.id)
        : [];
  courses.sort(
    (a, b) => Number(isOnMyWayCourse(b.url)) - Number(isOnMyWayCourse(a.url)),
  );
  const trainingArtwork =
    !!present &&
    event.coursesUnlocked &&
    courses.some((course) => course.available && isOnMyWayCourse(course.url))
      ? await onMyWayArtwork()
      : null;
  const survey = present
    ? await participantSurvey(person)
    : {
        available: false,
        published: false,
        submitted: false,
        unlockAt: event.endsAt.toISOString(),
      };
  if (preview && present) survey.available = true;
  const ready = !!present && (preview || certificateAvailable(event));
  const files =
    present && (await materialsUnlocked(event.id))
      ? await db()
          .select({ id: materials.id, title: materials.title })
          .from(materials)
          .where(
            and(eq(materials.eventId, event.id), eq(materials.published, true)),
          )
      : [];
  const credentials = JSON.parse(decrypt(person.credentials)) as {
    qrToken: string;
  };
  const qrUrl = `${new URL(process.env.APP_URL!).origin}/checkin/${credentials.qrToken}`;
  const qrImage = await QRCode.toDataURL(qrUrl, {
    width: 360,
    margin: 3,
    errorCorrectionLevel: "M",
  });
  const unlockedAt = event.certificateUnlockAt;
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
          {preview && !!present && (
            <p role="status">
              Podgląd testowy: wszystkie sekcje są widoczne. Kody i certyfikat
              są przykładowe.
            </p>
          )}
        </header>
        <section
          id="bilet"
          className={`${styles.card} ${styles.qrCard}`}
          aria-labelledby="qr-title"
        >
          <div className={styles.sectionLabel}>
            01 / Twój bilet elektroniczny
          </div>
          <h2 id="qr-title">Kod QR do wejścia</h2>
          <p>
            Przy wejściu pokaż ten kod QR obsłudze konferencji. Skan potwierdzi
            Twoją obecność.
          </p>
          <div className={styles.qrImage}>
            <Image
              src={qrImage}
              alt="Indywidualny kod QR do potwierdzenia obecności"
              width={360}
              height={360}
              unoptimized
              priority
            />
          </div>
          {!present && (
            <p className={styles.qrStatus}>
              Oczekuje na zeskanowanie przez obsługę
            </p>
          )}
        </section>
        {!!present && (
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
              <span>Bonusowe treści</span>
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
        )}
        {!present && <CheckinRefresh />}
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
          {[
            { number: "01", label: "Bilet", href: "#bilet", available: true },
            {
              number: "02",
              label: "Program",
              href: "#program",
              available: true,
            },
            {
              number: "03",
              label: "Ankieta",
              href: "#ankieta",
              available: !!present && survey.available,
            },
            {
              number: "04",
              label: "Certyfikat",
              href: "#certyfikat",
              available: !!present && ready,
            },
            {
              number: "05",
              label: "Szkolenia",
              href: "#szkolenia",
              available: !!present && event.coursesUnlocked,
            },
          ].map((section) =>
            section.available ? (
              <a
                key={section.number}
                href={section.href}
                className={styles.navigationRevealed}
              >
                <span>{section.number}</span>
                {section.label}
              </a>
            ) : (
              <div
                key={section.number}
                className={styles.navigationLocked}
                role="group"
                aria-label={`Sekcja ${section.number} - dostępna później`}
                title="Ta sekcja zostanie odsłonięta później"
              >
                <span>{section.number}</span>
                <i className={styles.hiddenLabel} aria-hidden="true" />
              </div>
            ),
          )}
        </nav>

        <section
          id="program"
          className={styles.card}
          aria-labelledby="program-title"
        >
          <div className={styles.sectionLabel}>02 / Spotykamy się</div>
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

        {!!present && files.length > 0 && (
          <ParticipantMaterials files={files} />
        )}
        {!!present && survey.available && (
          <section
            id="ankieta"
            className={styles.card}
            aria-labelledby="survey-title"
          >
            <div className={styles.sectionLabel}>
              03 / Twoja opinia ma znaczenie
            </div>
            <h2 id="survey-title">Ankieta</h2>
            <p>
              {!preview && survey.submitted
                ? "Dziękujemy! Twoje odpowiedzi zostały zapisane."
                : "Podziel się swoją opinią i pomóż nam przygotować kolejne spotkania."}
            </p>
            {(preview || !survey.submitted) && (
              <Link
                className={styles.communityAction}
                href={preview ? "/ankieta?podglad=1" : "/ankieta"}
              >
                <span>Kliknij i podziel się opinią</span>
                <span className={styles.communityArrow} aria-hidden="true">
                  →
                </span>
              </Link>
            )}
          </section>
        )}
        {!!present && ready && (
          <section
            id="certyfikat"
            className={styles.card}
            aria-labelledby="certificate-title"
          >
            <div className={styles.sectionLabel}>
              04 / Twój udział ma znaczenie
            </div>
            <h2 id="certificate-title">Certyfikat</h2>
            <p>Twój imienny certyfikat udziału w konferencji już czeka.</p>
            <a
              className={styles.communityAction}
              href={
                preview
                  ? "/przyklady/certyfikat-przykladowy.pdf"
                  : "/api/participant/certificate"
              }
              download
            >
              <span>Kliknij i odbierz certyfikat</span>
              <span className={styles.communityArrow} aria-hidden="true">
                ↓
              </span>
            </a>
          </section>
        )}
        {!!present && event.coursesUnlocked && (
          <>
            <section
              id="szkolenia"
              className={styles.card}
              aria-labelledby="training-title"
            >
              <div className={styles.sectionLabel}>05 / Rozwijaj się dalej</div>
              <h2 id="training-title">Dostęp do szkoleń</h2>
              <>
                {courses.length ? (
                  <TrainingCarousel>
                    {courses.map((course) => (
                      <article className={styles.course} key={course.id}>
                        <span className={styles.platform}>
                          {course.platform}
                        </span>
                        <h3>{course.name}</h3>
                        {course.available ? (
                          <>
                            {trainingArtwork && isOnMyWayCourse(course.url) && (
                              <>
                                <a
                                  href={course.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={styles.trainingArtwork}
                                >
                                  <Image
                                    src={trainingArtwork}
                                    width={1181}
                                    height={927}
                                    unoptimized
                                    alt="On my way - Joanna Chmura. Otwórz platformę szkoleniową."
                                  />
                                </a>
                              </>
                            )}
                            {course.code && (
                              <div className={styles.code}>
                                <span>Twój kod dostępu</span>
                                <code>{course.code}</code>
                              </div>
                            )}
                            <a
                              className={styles.communityAction}
                              href={course.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span>Przejdź do kursu</span>
                              <span
                                className={styles.communityArrow}
                                aria-hidden="true"
                              >
                                ↗
                              </span>
                            </a>
                          </>
                        ) : (
                          <p className={styles.notice}>
                            Organizator uzupełnia kody do tego szkolenia.
                            Sprawdź ponownie później.
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
              </>
            </section>
          </>
        )}
      </div>
    </ConferenceShell>
  );
}
