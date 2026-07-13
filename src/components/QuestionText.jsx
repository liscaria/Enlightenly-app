import { Fragment } from "react";

/** Render \vec{E}, \hat{i}, \frac{a}{b}, and line breaks in extracted question text. */
function tokenizePhysicsLine(line) {
  const tokens = [];
  const pattern =
    /\\vec\{([^}]+)\}|\\hat\{([A-Za-z])\}|\\frac\{([^{}]+)\}\{([^{}]+)\}|\[Figure:[^\]]+\]/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) {
      tokens.push({ type: "text", value: line.slice(last, match.index) });
    }
    if (match[1]) tokens.push({ type: "vec", value: match[1] });
    else if (match[2]) tokens.push({ type: "hat", value: match[2] });
    else if (match[3]) tokens.push({ type: "frac", num: match[3], den: match[4] });
    else tokens.push({ type: "figure", value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < line.length) tokens.push({ type: "text", value: line.slice(last) });
  return tokens;
}

function PhysicsVec({ symbol }) {
  return (
    <span className="physics-vec" aria-label={`vector ${symbol}`}>
      <span className="physics-vec__arrow" aria-hidden="true">
        →
      </span>
      {symbol}
    </span>
  );
}

function PhysicsHat({ letter }) {
  return (
    <span className="physics-hat" aria-label={`${letter} hat`}>
      {letter}
      <span className="physics-hat__mark" aria-hidden="true">
        ^
      </span>
    </span>
  );
}

function PhysicsFrac({ num, den }) {
  return (
    <span className="physics-frac" role="math">
      <span className="physics-frac__num">{num}</span>
      <span className="physics-frac__bar" aria-hidden="true" />
      <span className="physics-frac__den">{den}</span>
    </span>
  );
}

function renderToken(token, key) {
  switch (token.type) {
    case "vec":
      return <PhysicsVec key={key} symbol={token.value} />;
    case "hat":
      return <PhysicsHat key={key} letter={token.value} />;
    case "frac":
      return <PhysicsFrac key={key} num={token.num} den={token.den} />;
    case "figure":
      return (
        <em key={key} className="physics-figure-note">
          {token.value}
        </em>
      );
    default:
      return <Fragment key={key}>{token.value}</Fragment>;
  }
}

export default function QuestionText({ text, className = "practise-question-text" }) {
  if (!text) return null;
  const lines = `${text}`.split("\n");
  return (
    <p className={className}>
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 ? <br /> : null}
          {tokenizePhysicsLine(line).map((token, i) => renderToken(token, `${lineIndex}-${i}`))}
        </Fragment>
      ))}
    </p>
  );
}
