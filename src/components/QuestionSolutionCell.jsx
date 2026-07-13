/** Solution column: toggle or em dash when empty. */
export default function QuestionSolutionCell({
  solution,
  questionId,
  expanded,
  onToggle,
}) {
  const text = solution && `${solution}`.trim();
  if (!text) {
    return <span className="question-solution-cell question-solution-cell--empty">—</span>;
  }

  return (
    <div className="question-solution-cell">
      <button
        type="button"
        className="practise-solution-link"
        onClick={() => onToggle(questionId)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide" : "View"}
      </button>
      {expanded ? (
        <div className="practise-question-solution question-solution-cell__body">
          <p>{text}</p>
        </div>
      ) : null}
    </div>
  );
}
