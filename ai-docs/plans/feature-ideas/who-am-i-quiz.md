# Who Am I? quiz

A learning game played on the canvas itself. A riddle appears ("I painted a ceiling while lying on scaffolding for four years…") and the user answers by clicking the right bar. Clues are revealed one at a time: the fewer clues needed, the more points. Each answer leads into the figure's biography, so the game feeds back into exploration.

## Behavior

- **Entry.** "Quiz me" in the control panel. Requires at least 6 people or events on the canvas.
- **Round.** 8 questions by default (5 / 8 / 12 selectable). Question types:
  1. **Who am I?** (main type): 3 clues from vague to specific about a canvas figure. Answer by clicking its bar.
  2. **What happened?** The same format for an event.
  3. **Who came first?** Two highlighted bars; click the one born or started earlier. This type is generated locally from figure years, with no AI.
  4. **Were they contemporaries?** Two names; answer Yes or No. Also generated locally (lifespans overlap).
  5. **Connection** (only when verified assessments exist): "Which of these knew Galileo?" Three highlighted bars, one with a cached positive assessment. Generated locally from the `chrono_assessment_` cache, so no AI is needed and no unverified claims are used.
  About 60% of questions are AI "Who am I?"/"What happened?" and the rest are local, which keeps the game playable cheaply and offline-ish.
- **Clue card.** Floats top-centre and shows the revealed clues, a "Next clue" button, a "Skip" button, a question counter, and the score.
- **Answering.**
  - The canvas stays fully interactive. Clicking a bar in quiz mode answers instead of opening the action bar.
  - Correct: the bar glows green with confetti (CSS, honours reduced motion), and the reveal card shows a one-line "why" plus "Read biography".
  - Wrong: a gentle shake on the clicked bar, and the next clue is revealed automatically. After the third wrong guess the answer is revealed and the camera flies to it.
- **Scoring.** 3 / 2 / 1 points for an answer after 1 / 2 / 3 clues, 0 if revealed, and a streak bonus. The end screen shows the score, the best streak, and "Figures you met" (chips that open biographies).
- **Difficulty.** "Easy" hides category filters and makes the camera show the whole canvas; "Hard" removes names from bars during the question. Name hiding is a CSS class on the canvas.
- **Fairness.** Answers are limited to visible figures. If the answer's category is filtered out, the filter is temporarily lifted during the question.
- **Persistence.** The generated question pack is cached per canvas (`chrono_quiz_<canvasId>`) so replays are instant; "New questions" regenerates it. The best score per canvas is stored with the canvas snapshot and shown in the history popover (`CanvasHistory`) as "Quiz best: 19/24".

## AI task

`fetchQuizClues(figures, count, context, signal)` → `[{ figureId, clues: [string, string, string], reveal: string }]`.

- Uses the canvas catalog (grounding rule).
- Clues must not contain the name, obvious name fragments, or exact birth/death years in clue 1. They move from context (era, region, field) to the defining achievement, and must be factual (`READER_STYLE`, no invented quotes).
- `reveal`: one sentence on why this person or event mattered.
- Choose a mix of well-known and lesser-known canvas entries, spread across categories and time.
- Validation: drop unknown IDs and duplicates. Reject clues that contain the figure's name or surname (case-insensitive token check) and send one corrective retry through `generateValidatedJson`. Require at least half of the requested count; otherwise fill the gap with local questions.

## Implementation

1. Types, prompt, parser, `JsonTask: 'quiz'`, and three provider implementations.
2. `src/utils/quizQuestions.ts`: local generators (who came first, contemporaries, connection from cache), mixing, and shuffle with a seed for testing.
3. `src/hooks/useQuiz.ts`: round state machine (`loading → asking → revealed → … → finished`), scoring, and persistence.
4. `QuizClueCard.tsx`, `QuizResults.tsx`, and canvas props `quizMode`, `quizHighlightIds`, `hideNames`, `answerFeedback` for both layouts.
5. Click routing in App: in quiz mode, a bar click answers. Mutual exclusion and abort on canvas switch.
6. Add `quizBest` to the snapshot type and normalisation, and to the history popover. Add `chrono_quiz_` to `isCanvasCacheKey`.
7. Tests: name-leak rejection, local generators (overlap boundaries, BCE years), the connection question uses only positive cached assessments, scoring, and snapshot normalisation for `quizBest`.

## Open questions

- Should "Hard" mode (hidden names) ship in v1?
- Should there be a timed mode?
