import { useEffect, useRef, useState } from "react";
import { confidenceTier } from "../constants/classificationReview.js";

/** Chapter assignment with confidence badge and alternative picker (Phase 4). */
export default function QuestionChapterCell({
  chapterId: assignedChapterId = null,
  chapterName,
  confidence = null,
  reviewStatus = null,
  alternatives = [],
  chapters = [],
  onSelectChapter,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!chapterName?.trim()) {
    return <span className="question-chapter-cell question-chapter-cell--empty">—</span>;
  }

  const confidencePct =
    confidence != null && Number.isFinite(Number(confidence))
      ? Math.round(Number(confidence))
      : null;
  const tier = confidenceTier(
    confidencePct != null ? confidencePct / 100 : null
  );
  const currentChapterId =
    assignedChapterId ?? chapters.find((c) => c.name === chapterName)?.id ?? null;

  const ranked = [
    {
      rank: 1,
      chapterId: currentChapterId,
      chapterName,
      score: confidencePct != null ? confidencePct / 100 : null,
    },
    ...(alternatives || []).map((alt, index) => ({
      rank: index + 2,
      chapterId: alt.chapter_id ?? alt.chapterId,
      chapterName: alt.chapter_name ?? alt.chapterName ?? "",
      score: alt.score ?? null,
    })),
  ].filter((r) => r.chapterName && r.chapterId);

  const rankedIds = new Set(ranked.map((r) => r.chapterId));
  const otherChapters = chapters.filter((ch) => !rankedIds.has(ch.id));

  const handlePick = (chapterId) => {
    if (disabled || !onSelectChapter || !chapterId) return;
    onSelectChapter(chapterId);
    setOpen(false);
  };

  return (
    <div className="question-chapter-cell-wrap" ref={rootRef}>
      <button
        type="button"
        className={`question-chapter-cell question-chapter-cell--${tier}${
          open ? " question-chapter-cell--open" : ""
        }`}
        disabled={disabled}
        title={
          reviewStatus
            ? `${chapterName}${confidencePct != null ? ` · ${confidencePct}%` : ""} · ${reviewStatus}`
            : chapterName
        }
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="question-chapter-cell__name">{chapterName}</span>
      </button>

      {open && !disabled ? (
        <div className="question-chapter-picker" role="dialog" aria-label="Chapter candidates">
          <p className="question-chapter-picker__heading">Chapter candidates</p>
          <ul className="question-chapter-picker__ranked">
            {ranked.map((row) => (
              <li key={`${row.rank}-${row.chapterId}`}>
                <button
                  type="button"
                  className={`question-chapter-picker__rank-row${
                    row.chapterId === currentChapterId
                      ? " question-chapter-picker__rank-row--assigned"
                      : ""
                  }`}
                  onClick={() => handlePick(row.chapterId)}
                >
                  <span className="question-chapter-picker__rank-no">{row.rank}</span>
                  <span className="question-chapter-picker__rank-name">{row.chapterName}</span>
                  <span className="question-chapter-picker__rank-score">
                    {row.score != null ? `${Math.round(row.score * 100)}%` : "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {otherChapters.length > 0 && onSelectChapter ? (
            <>
              <p className="question-chapter-picker__heading">Other chapters</p>
              <ul className="question-chapter-picker__list">
                {otherChapters.map((ch) => (
                  <li key={ch.id}>
                    <button
                      type="button"
                      className="question-chapter-picker__option"
                      onClick={() => handlePick(ch.id)}
                    >
                      {ch.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
