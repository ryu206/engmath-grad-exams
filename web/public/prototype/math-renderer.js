(function () {
  const KATEX_VERSION = '0.16.11';
  const DEFAULT_RENDERER = 'mathjax';
  const FONT_LOAD_TIMEOUT_MS = 1500;
  const containerState = new WeakMap();
  const latexByElement = new WeakMap();
  const knownContainers = new Set();
  const supportedMathPattern = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g;
  const excludedHtmlPattern = /<(code|pre|textarea|script|style)\b[\s\S]*?<\/\1>/gi;
  let activeRenderer = currentRenderer();
  let loadingPromise = null;
  let latexModal = null;
  let mathCopyId = 0;

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

  function mathCopyMode(container) {
    if (document.documentElement.dataset.mathCopy !== 'modal') return 'off';
    if (container.closest('[data-math-copy="off"]')) return 'off';
    return 'modal';
  }

  function latexSourceFromHtml(latexHtml) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = latexHtml.replace(/<br\s*\/?>/gi, '\n');
    return textarea.value;
  }

  function protectExcludedHtml(sourceHtml) {
    const blocks = [];
    const html = sourceHtml.replace(excludedHtmlPattern, (block) => {
      const index = blocks.push(block) - 1;
      return `\uE000MATH_COPY_BLOCK_${index}\uE001`;
    });
    return { html, blocks };
  }

  function restoreExcludedHtml(sourceHtml, blocks) {
    return sourceHtml.replace(/\uE000MATH_COPY_BLOCK_(\d+)\uE001/g, (_match, index) => blocks[Number(index)] || '');
  }

  function wrapMathCopySourceHtml(sourceHtml, renderer) {
    const { html: protectedHtml, blocks } = protectExcludedHtml(sourceHtml);
    const latexById = new Map();
    supportedMathPattern.lastIndex = 0;
    const wrappedHtml = protectedHtml.replace(supportedMathPattern, (latexHtml) => {
      const id = `math-copy-${++mathCopyId}`;
      const sourceLatex = latexSourceFromHtml(latexHtml);
      const displayLatexHtml = renderer === 'katex' ? normalizeLatexForKatex(latexHtml) : latexHtml;
      const displayClass = /^\\\[|\$\$/.test(latexHtml) ? 'math-copy-display' : 'math-copy-inline';
      latexById.set(id, sourceLatex);
      return `<span class="math-copy ${displayClass}" data-math-copy-id="${id}" tabindex="0" role="button" aria-label="Open LaTeX source" title="Open LaTeX source">${displayLatexHtml}</span>`;
    });

    return {
      html: restoreExcludedHtml(wrappedHtml, blocks),
      latexById
    };
  }

  function bindMathCopyTargets(container, latexById) {
    container.querySelectorAll('.math-copy[data-math-copy-id]').forEach((element) => {
      if (element.closest('.choice-option')) {
        element.classList.remove('math-copy');
        element.removeAttribute('data-math-copy-id');
        element.removeAttribute('tabindex');
        element.removeAttribute('role');
        element.removeAttribute('aria-label');
        element.removeAttribute('title');
        return;
      }

      const latex = latexById.get(element.dataset.mathCopyId);
      if (!latex) return;
      latexByElement.set(element, latex);
      element.removeAttribute('data-math-copy-id');
    });
  }

  function createLatexModal() {
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'mathLatexModal';
    modal.tabIndex = -1;
    modal.setAttribute('aria-labelledby', 'mathLatexModalTitle');
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title fs-5" id="mathLatexModalTitle">LaTeX source</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <textarea class="form-control font-monospace math-latex-source" rows="8" readonly></textarea>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-primary" data-math-copy-latex>Copy</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const textarea = modal.querySelector('.math-latex-source');
    const copyButton = modal.querySelector('[data-math-copy-latex]');
    copyButton.addEventListener('click', async () => {
      textarea.focus();
      textarea.select();
      try {
        await navigator.clipboard.writeText(textarea.value);
        copyButton.textContent = 'Copied';
        window.setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 1200);
      } catch (_error) {
        document.execCommand('copy');
      }
    });
    modal.addEventListener('click', (event) => {
      if (event.target.matches('[data-bs-dismiss="modal"]')) hideFallbackLatexModal();
    });

    return modal;
  }

  function showLatexModal(latex) {
    if (!latexModal) latexModal = createLatexModal();

    const textarea = latexModal.querySelector('.math-latex-source');
    textarea.value = latex;

    if (window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(latexModal).show();
      window.setTimeout(() => textarea.focus(), 150);
      return;
    }

    latexModal.classList.add('show');
    latexModal.style.display = 'block';
    latexModal.removeAttribute('aria-hidden');
    textarea.focus();
  }

  function hideFallbackLatexModal() {
    if (!latexModal || window.bootstrap?.Modal) return;
    latexModal.classList.remove('show');
    latexModal.style.display = 'none';
    latexModal.setAttribute('aria-hidden', 'true');
  }

  function openMathCopyTarget(target) {
    const latex = latexByElement.get(target);
    if (!latex) return;
    showLatexModal(latex);
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

      if (mathCopyMode(container) === 'modal') {
        const wrappedSource = wrapMathCopySourceHtml(sourceHtml, renderer);
        container.innerHTML = wrappedSource.html;
        bindMathCopyTargets(container, wrappedSource.latexById);
      } else {
        const renderHtml = renderer === 'katex' ? normalizeLatexForKatex(sourceHtml) : sourceHtml;
        container.innerHTML = renderHtml;
      }
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

  function installMathCopyInteractions() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('.math-copy');
      if (!target) return;
      if (target.closest('.choice-option')) return;
      event.preventDefault();
      openMathCopyTarget(target);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target.closest('.math-copy');
      if (!target) return;
      if (target.closest('.choice-option')) return;
      event.preventDefault();
      openMathCopyTarget(target);
    });
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
    document.addEventListener('DOMContentLoaded', () => {
      installToggle();
      installMathCopyInteractions();
    }, { once: true });
  } else {
    installToggle();
    installMathCopyInteractions();
  }
})();
