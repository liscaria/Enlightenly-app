import {
  DIFFICULTY_NOT_RATED,
  isRatedDifficulty,
} from "../constants/difficultyLevels.js";

const SEGMENTS = [
  { level: "Low", label: "LOW", color: "#e05252" },
  { level: "Medium", label: "MEDIUM", color: "#f0b429" },
  { level: "High", label: "HIGH", color: "#8bc34a" },
];

const GREY_FILL = "#c8cdd4";
const GREY_LABEL = "#a8adb5";

function segmentStyle(seg, value, rated) {
  if (!rated || value !== seg.level) {
    return { backgroundColor: GREY_FILL, color: GREY_LABEL };
  }
  return { backgroundColor: seg.color, color: "#ffffff" };
}

const CARET_LEFT = {
  Low: "16.666%",
  Medium: "50%",
  High: "83.333%",
};

/** Horizontal pill bar — all grey until rated; only the chosen segment gets color. */
export default function DifficultyGauge({
  value = DIFFICULTY_NOT_RATED,
  onChange,
  disabled = false,
}) {
  const rated = isRatedDifficulty(value);

  const handlePick = (level) => {
    if (disabled || !onChange) return;
    onChange(level);
  };

  return (
    <div
      className={`difficulty-gauge${rated ? " difficulty-gauge--rated" : " difficulty-gauge--unrated"}`}
      role="group"
      aria-label={
        rated
          ? `Difficulty: ${value}. Click a segment to change.`
          : "Difficulty not rated. Click Low, Medium, or High."
      }
    >
      <div className="difficulty-gauge__bar">
        {SEGMENTS.map((seg) => (
          <button
            key={seg.level}
            type="button"
            className="difficulty-gauge__segment"
            style={segmentStyle(seg, value, rated)}
            disabled={disabled}
            aria-pressed={value === seg.level}
            onClick={() => handlePick(seg.level)}
          >
            {seg.label}
          </button>
        ))}
      </div>

      {rated ? (
        <div className="difficulty-gauge__caret-wrap" aria-hidden="true">
          <span
            className="difficulty-gauge__caret"
            style={{ left: CARET_LEFT[value] }}
          />
        </div>
      ) : null}
    </div>
  );
}
