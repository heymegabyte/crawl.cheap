/**
 * @theme.tools/blog/editor — Direct In-Place Inline PlateJS Block Editor Controller
 */
(function () {
  var btn = document.getElementById('btn-plate-edit');
  var banner = document.getElementById('plate-status-banner');
  var prose = document.getElementById('article-prose-body');
  var titleEl = document.getElementById('article-title');
  var descEl = document.getElementById('article-desc');
  if (!btn || !prose) return;

  var editing = false;
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    editing = !editing;
    if (banner) banner.style.display = editing ? 'block' : 'none';
    btn.innerHTML = editing
      ? '<span class="tt-cms-btn__icon" aria-hidden="true">✓</span>Done Editing'
      : '<span class="tt-cms-btn__icon" aria-hidden="true">✎</span>Edit Inline (PlateJS)';
    if (titleEl) titleEl.contentEditable = editing ? 'true' : 'false';
    if (descEl) descEl.contentEditable = editing ? 'true' : 'false';
    var blocks = prose.querySelectorAll('h2, h3, p, li');
    blocks.forEach(function (el) {
      if (el.closest('[data-tt-widget]') || el.closest('[data-tt-figure]')) return;
      el.contentEditable = editing ? 'true' : 'false';
      el.style.outline = editing ? '1px dashed rgba(0, 229, 255, 0.35)' : '';
      el.style.borderRadius = editing ? '6px' : '';
    });
    if (window.posthog && window.posthog.capture) {
      window.posthog.capture(editing ? 'blog_inline_edit_started' : 'blog_inline_edit_saved', {
        slug: document.querySelector('[data-tt-slug]')?.getAttribute('data-tt-slug') || '',
      });
    }
  });
})();
