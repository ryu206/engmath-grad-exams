# KaTeX Mobile Overflow Handling

## Problem

Long KaTeX formulas can exceed the viewport on mobile devices. When that happens, the page may become horizontally scrollable, cards may widen beyond the screen, or nearby text may become difficult to read.

This is especially likely for:

- Long display formulas inside `$$ ... $$`.
- Long inline formulas inside `\( ... \)` or `$ ... $`.
- Formula-heavy question, subquestion, and answer text.

## Current Approach

The prototype pages use a shared stylesheet:

```html
<link href="/prototype/math-render-overflow.css" rel="stylesheet">
```

The stylesheet keeps the page width stable and lets long display formulas scroll horizontally inside their own KaTeX block:

```css
.katex-display {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 5px;
}
```

Container rules also keep question cards, choices, and preview panes from being widened by long math content.

## Why Horizontal Scrolling

Horizontal scrolling is preferred over shrinking every formula because it preserves mathematical readability. On small screens, aggressively scaling formulas down often makes symbols, fractions, and subscripts too small to inspect.

The intended behavior is:

- Text and cards stay within the viewport.
- Question choices and subquestion choices stay within their list items.
- Long display formulas keep their natural KaTeX size.
- Users can swipe horizontally on the formula itself when needed.

## Pages Covered

The shared stylesheet is currently loaded by:

- `/prototype/exam-questions.html`
- `/prototype/independent-questions.html`
- `/prototype/question.html`
- `/prototype/questions.html`
- `/prototype/edit-question.html`
- `/prototype/answers.html`
- `/prototype/edit-answer.html`

## Authoring Guidance

Use display math for formulas that are visually independent or likely to be long:

```tex
$$
\int_0^\infty \frac{x^{a-1}}{1+x}\,dx = \frac{\pi}{\sin(\pi a)}
$$
```

Avoid placing very long formulas inline with normal prose. If an inline formula becomes too long on mobile, convert it to display math so the overflow handling can apply cleanly.

If a formula needs multiple lines, write it with TeX structures such as `aligned`, `split`, or explicit line breaks.
