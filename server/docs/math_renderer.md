# Math Renderer Switching

Prototype pages use `/prototype/math-renderer.js` to switch between MathJax and KaTeX without reloading the page.

## URL Parameters

- `?renderer=mathjax` uses MathJax.
- `?renderer=katex` uses KaTeX.
- No `renderer` parameter uses the page default from `data-default-math-renderer` on the `<html>` element.

When `renderer=katex`, the MathJax script is not loaded. Renderer switching updates the URL with `history.replaceState()` and re-renders already loaded content, so question data is not fetched again and edit form input state is preserved.

## KaTeX Preprocessing

When the active renderer is KaTeX, the shared renderer applies a conservative preprocessing pass before calling `renderMathInElement()`. This is meant to absorb common database content that MathJax accepts but KaTeX handles less gracefully.

Current replacements:

- blank paragraphs are collapsed before KaTeX rendering to avoid `\par`-style parse problems
- leading/trailing whitespace inside `\(...\)`, `\[...\]`, and `$$...$$` is trimmed
- `<br>` tags inside math delimiters are converted back to whitespace/newlines before KaTeX sees them
- inline `\(...\)` formulas containing block-like environments are promoted to display `\[...\]`
- `\begin{align}` and `\begin{align*}` -> `\begin{aligned}`
- `\end{align}` and `\end{align*}` -> `\end{aligned}`
- `\begin{gather}` and `\begin{gather*}` -> `\begin{gathered}`
- `\end{gather}` and `\end{gather*}` -> `\end{gathered}`

This preprocessing only changes the render-time HTML source. It does not write back to the database and does not mutate the stored text in form fields.

The `<br>` handling is needed because prototype pages escape user/database text and convert text newlines to `<br>` before rendering previews. MathJax tolerates multiline inline delimiters more readily, but KaTeX can fail when an inline formula arrives as `\(<br>...\<br>\)`. The renderer keeps normal `<br>` tags outside math unchanged, while normalizing only the content inside supported math delimiters.

Block-like environments currently include matrix variants, `cases`, `align`, `align*`, `aligned`, `gather`, `gather*`, `gathered`, and `array`. This handles database content such as `\( A=\begin{bmatrix}...\end{bmatrix} \)` by rendering it as display math in KaTeX while preserving the stored source text.

## Page Defaults

Browsing and list pages default to KaTeX for faster rendering:

- `/prototype/exam-questions.html`
- `/prototype/independent-questions.html`
- `/prototype/question.html`

Editing and input pages default to MathJax for authoring tolerance:

- `/prototype/questions.html`
- `/prototype/edit-question.html`
- `/prototype/answers.html`
- `/prototype/edit-answer.html`

To change a page default later, update:

```html
<html lang="zh-Hant" data-default-math-renderer="katex">
```

## Covered Pages

- `/prototype/exam-questions.html`
- `/prototype/independent-questions.html`
- `/prototype/question.html`
- `/prototype/questions.html`
- `/prototype/edit-question.html`
- `/prototype/answers.html`
- `/prototype/edit-answer.html`

## LaTeX Source Modal

Reading pages can opt in to clickable rendered formulas with:

```html
<html lang="zh-Hant" data-default-math-renderer="katex" data-math-copy="modal">
```

The first implementation is enabled only on formal reading pages:

- `/prototype/exam-questions.html`
- `/prototype/independent-questions.html`
- `/prototype/question.html`

The shared renderer only wraps these delimiters:

- `\( ... \)`
- `\[ ... \]`
- `$$ ... $$`

Single-dollar math is intentionally ignored to avoid false positives in money amounts and ordinary text. The wrapper is created with DOM APIs, and the original LaTeX string is stored in a `WeakMap` instead of an HTML `data-*` attribute. This avoids attribute escaping problems with quotes, backslashes, and multiline formulas.

The parser protects `code`, `pre`, `textarea`, `script`, and `style` blocks before wrapping formulas. Editing and input pages do not opt in, so raw LaTeX input fields and live preview areas remain unchanged in the first version.

For KaTeX, the displayed formula text is normalized before auto-rendering so multiline inline formulas such as:

```tex
\(
y^{(4)}-6y''+8y'-3y=0
\)
```

render like the single-line form. The modal still shows the original source, and formulas containing HTML `<br>` line breaks are converted back to real newlines in the modal text.

## Overflow CSS

The shared stylesheet is:

```html
<link href="/prototype/math-render-overflow.css" rel="stylesheet">
```

It keeps long display formulas horizontally scrollable without widening the page. It also keeps choice list items from widening the page when a choice contains a long formula.

Choice inputs on browsing pages are visually represented by a leading check mark instead of native radio or checkbox controls. The check mark is absolutely positioned, so unselected choices do not reserve blank space before the option text. Single-choice questions still allow at most one selected option in the same choice list, but the selected option can be clicked again to clear it. Multiple-choice questions allow any number of selected options.

## Rendering State Classes

The renderer service temporarily hides math containers while the active renderer is loading or rendering:

- `.math-rendering`: applied before loading/rendering starts; hides raw TeX text and shows a small in-place typesetting notice at the top-left edge of the container.
- `.math-render-ready`: applied after rendering finishes; fades rendered output in with a short opacity transition.

This prevents users from briefly seeing unrendered source such as:

```tex
F(\omega)=\frac{1}{\sqrt{2\pi}}\int_{-\infty}^{\infty}f(t)e^{-i\omega t}\,dt.
```

The service removes `.math-render-ready`, sets `data-math-rendering-label`, marks the container `aria-busy="true"`, adds `.math-rendering`, loads the active renderer if needed, restores the saved source HTML, renders the math, then switches the classes in a `finally` block. If the renderer CDN fails, the content is shown again instead of staying invisible forever.

This is intentionally lighter than a full-page loading state. The delay is usually short, and the notice is scoped to the math container so the rest of the page remains usable.

## CDN and Font Fallback

The renderer dynamically loads KaTeX CSS/JS and MathJax JS from jsDelivr. For KaTeX, the CSS then requests WOFF2 font files from the same CDN path.

To reduce failure cases:

- stylesheet and script loading are wrapped in promises and awaited
- KaTeX performs a short `document.fonts.load()` readiness check for key font families
- if font loading stalls, the renderer logs a warning that CSP, firewall, or offline mode may be blocking WOFF2 assets
- if renderer loading or rendering fails, the service restores the original source text and reveals the container instead of leaving it blank forever

This does not fully solve hostile CSP or offline environments, but it makes failure mode explicit and keeps the page usable.
