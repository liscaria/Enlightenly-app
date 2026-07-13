import { getExtractionQualityDetailLines } from "../api/extractionQualityReport.js";

/** Extraction quality badge + hover details / modal summary. */
export default function ExtractionQualityPanel({ report, compact = false }) {
  if (!report) return null;

  const { validationStatus, extractedCount, expectedCount, status } = report;
  const detailLines = getExtractionQualityDetailLines(report);

  const statusClass =
    validationStatus === "Passed"
      ? "extraction-quality--passed"
      : validationStatus === "Needs Review"
        ? "extraction-quality--review"
        : validationStatus === "Failed"
          ? "extraction-quality--failed"
          : "extraction-quality--pending";

  if (compact) {
    if (status === "Not Extracted") return null;
    if (validationStatus === "Passed") {
      return (
        <span className={`extraction-quality-badge ${statusClass}`}>Passed</span>
      );
    }

    return (
      <span className="extraction-quality-hover">
        <span className={`extraction-quality-badge ${statusClass}`} tabIndex={0}>
          Needs Review
        </span>
        <span className="extraction-quality-hover__popup" role="tooltip">
          <span className="extraction-quality-hover__title">
            Extraction quality details
          </span>
          <ul className="extraction-quality-hover__list">
            {detailLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </span>
      </span>
    );
  }

  if (status === "Not Extracted") return null;

  return (
    <section
      className={`extraction-quality-panel ${statusClass}`}
      aria-label="Extraction quality details"
    >
      <h3 className="extraction-quality-panel__title">Extraction quality details</h3>
      <ul className="extraction-quality-panel__list">
        {detailLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {validationStatus === "Passed" ? (
        <p className="extraction-quality-panel__ok">
          All {expectedCount} questions are present with no duplicates.
        </p>
      ) : null}
    </section>
  );
}
