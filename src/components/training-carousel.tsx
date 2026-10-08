"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "@/app/uczestnik/panel/panel.module.css";

export function TrainingCarousel({ children }: { children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = track.current;
    if (!element) return;

    function handleWheel(event: WheelEvent) {
      if (!element || event.ctrlKey || event.shiftKey) return;
      // Gesty poziome pozostają obsługiwane natywnie przez przeglądarkę.
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientWidth
            : 1;
      const delta = event.deltaY * unit;
      const max = element.scrollWidth - element.clientWidth;
      const next = Math.max(0, Math.min(max, element.scrollLeft + delta));
      if (Math.abs(next - element.scrollLeft) < 1) return;
      event.preventDefault();
      element.scrollLeft = next;
    }

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div className={styles.carousel}>
      <div
        ref={track}
        className={styles.courseTrack}
        tabIndex={0}
        role="region"
        aria-label="Szkolenia, przewijaj w lewo i w prawo"
      >
        {children}
      </div>
    </div>
  );
}
