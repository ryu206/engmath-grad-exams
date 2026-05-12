(function () {
  const KATEX_VERSION = '0.16.11';
  const DEFAULT_RENDERER = 'mathjax';
  const FONT_LOAD_TIMEOUT_MS = 1500;
  const containerState = new WeakMap();
  const knownContainers = new Set();
  let activeRenderer = currentRenderer();
  let loadingPromise = null;

  function currentRenderer() {
    const params = new URLSearchParams(window.location.search);
    const requestedRenderer = params.get('renderer');
    if (requestedRenderer === 'katex' || requestedRenderer === 'mathjax') return requestedRenderer;
    const pageDefault = document.documentElement.dataset.defaultMathRenderer;
    return pageDefault === 'katex' ? 'katex' : DEFAULT_RENDERER;
  }

  function setRendererParam(renderer) {
    const url = new URL(window.location.href);
    url.searchParams.set('renderer', renderer);
    window.history.replaceState({}, '', url);
  }

  function timeout(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function loadStylesheet(id, href) {
    const existing = document.getElementById(id);
    if (existing?.dataset.loaded === 'true') return Promise.resolve();
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      link.addEventListener('load', () => {
        link.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      link.addEventListener('error', reject, { once: true });
      document.head.appendChild(link);
    });
  }

  function loadScript(id, src) {
    const existing = document.getElementById(id);
    if (existing?.dataset.loaded === 'true') return Promise.resolve();
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.defer = true;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.appendChild(script);
    });
  }

  async function ensureKatexFontsReady() {
    if (!document.fonts?.load) return;
    const fontChecks = [
      'KaTeX_Main',
      'KaTeX_Math',
      'KaTeX_Size1'
    ].map((fontFamily) => document.fonts.load(`16px "${fontFamily}"`).catch(() => []));

    const fontResult = await Promise.race([
      Promise.allSettled(fontChecks),
      timeout(FONT_LOAD_TIMEOUT_MS).then(() => 'timeout')
    ]);

    if (fontResult === 'timeout') {
      console.warn('KaTeX font loading timed out. CSP, firewall, or offline mode may be blocking WOFF2 assets.');
    }
  }

  function normalizeLatexForKatex(sourceHtml) {
    return sourceHtml
      .replace(/\n\s*\n/g, '\n')
      .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_match, math) => {
        const inlineMath = normalizeMathContentForKatex(math, false);
        if (hasBlockMathEnvironment(inlineMath)) {
          return `\\[${normalizeMathContentForKatex(math, true)}\\]`;
        }

        return `\\(${inlineMath}\\)`;
      })
      .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_match, math) => `\\[${normalizeMathContentForKatex(math, true)}\\]`)
      .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, math) => `$$${normalizeMathContentForKatex(math, true)}$$`)
      .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
      .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
      .replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}')
      .replace(/\\end\{gather\*?\}/g, '\\end{gathered}');
  }

  function normalizeMathContentForKatex(math, displayMode) {
    const htmlBreakReplacement = displayMode ? '\n' : ' ';
    return math
      .replace(/<br\s*\/?>/gi, htmlBreakReplacement)
      .replace(/(?:&nbsp;|\u00a0)/g, ' ')
      .replace(/[ \t\f\v]+/g, ' ')
      .trim();
  }

  function hasBlockMathEnvironment(math) {
    return /\\begin\{(?:matrix|[pbBvV]?matrix|cases|align\*?|aligned|gather\*?|gathered|array)\}/.test(math);
  }

  async function ensureRendererLoaded(renderer) {
    if (renderer === 'katex') {
      await loadStylesheet('katex-css', `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`);
      await loadScript('katex-js', `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js`);
      await loadScript('katex-auto-render-js', `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/contrib/auto-render.min.js`);
      await ensureKatexFontsReady();
      return;
    }

    if (!window.MathJax) {
      window.MathJax = {
        tex: {
          inlineMath: [['$', '$'], ['\\(', '\\)']],
          displayMath: [['$$', '$$'], ['\\[', '\\]']]
        },
        svg: { fontCache: 'global' }
      };
    }
    await loadScript('mathjax-tex-svg-js', 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js');
    if (window.MathJax?.startup?.promise) await window.MathJax.startup.promise;
  }

  function sourceFor(container) {
    const state = containerState.get(container);
    if (!state || container.innerHTML !== state.renderedHtml) {
      return container.innerHTML;
    }
    container.innerHTML = state.sourceHtml;
    return state.sourceHtml;
  }

  async function renderContainer(container) {
    if (!container) return;
    knownContainers.add(container);
    const sourceHtml = sourceFor(container);
    const renderer = activeRenderer;

    container.classList.remove('math-render-ready');
    container.dataset.mathRenderingLabel = renderer === 'katex' ? 'KaTeX 公式排版中...' : 'MathJax 公式排版中...';
    container.setAttribute('aria-busy', 'true');
    container.classList.add('math-rendering');

    loadingPromise = ensureRendererLoaded(renderer);
    try {
      await loadingPromise;

      const renderHtml = renderer === 'katex' ? normalizeLatexForKatex(sourceHtml) : sourceHtml;
      container.innerHTML = renderHtml;
      if (renderer === 'katex' && typeof window.renderMathInElement === 'function') {
        window.renderMathInElement(container, {
          throwOnError: false,
          errorCallback: () => {},
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false },
            { left: '$', right: '$', display: false }
          ]
        });
      } else if (window.MathJax?.typesetPromise) {
        await window.MathJax.typesetPromise([container]);
      }

      containerState.set(container, {
        sourceHtml,
        renderedHtml: container.innerHTML
      });
    } catch (error) {
      container.innerHTML = sourceHtml;
      containerState.set(container, {
        sourceHtml,
        renderedHtml: container.innerHTML
      });
      console.warn(`Failed to render ${renderer}. Falling back to source text.`, error);
    } finally {
      container.classList.remove('math-rendering');
      container.removeAttribute('data-math-rendering-label');
      container.removeAttribute('aria-busy');
      container.classList.add('math-render-ready');
    }
  }

  function updateButton(button) {
    if (!button) return;
    button.textContent = activeRenderer === 'katex' ? 'KaTeX' : 'MathJax';
    button.title = activeRenderer === 'katex' ? 'Using KaTeX. Switch to MathJax.' : 'Using MathJax. Switch to KaTeX.';
    button.setAttribute('aria-label', button.title);
  }

  async function switchRenderer(nextRenderer) {
    activeRenderer = nextRenderer === 'katex' ? 'katex' : 'mathjax';
    setRendererParam(activeRenderer);
    updateButton(document.querySelector('[data-renderer-toggle]'));
    await Promise.all([...knownContainers].map((container) => renderContainer(container)));
  }

  function installToggle() {
    if (document.querySelector('[data-renderer-toggle]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.rendererToggle = 'true';
    button.className = 'renderer-toggle btn btn-outline-secondary btn-sm';
    updateButton(button);
    button.addEventListener('click', () => {
      switchRenderer(activeRenderer === 'katex' ? 'mathjax' : 'katex');
    });
    document.body.appendChild(button);
  }

  window.renderMath = (container) => {
    renderContainer(container).catch((error) => {
      console.error('Failed to render math:', error);
    });
  };
  window.setMathRenderer = (renderer) => {
    switchRenderer(renderer).catch((error) => {
      console.error('Failed to switch math renderer:', error);
    });
  };
  window.getMathRenderer = () => activeRenderer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installToggle, { once: true });
  } else {
    installToggle();
  }
})();
