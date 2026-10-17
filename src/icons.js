// Real vector icons for the whole UI.
//
// The game must never show an emoji: an emoji is a *font*, so U+1F48E is a
// different drawing on Android, iOS, Windows and Linux, and on a bare Linux box
// it is a tofu box. Everything visible in the game is drawn from the SVG sprite
// in index.html instead, so it is identical on every device and needs no font.
//
//   icon('gems')  ->  '<svg class="ic"><use href="#i-gems"/></svg>'

/**
 * Markup for one sprite icon. Safe to interpolate into innerHTML.
 * @param {string} name  sprite symbol id, without the "i-" prefix
 * @param {string} [cls] extra class, e.g. "spin" for the connection spinner
 */
export function icon(name, cls = '') {
  const klass = cls ? ` ic ${cls}` : ' ic';
  return `<svg class="${klass.trim()}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape before interpolating player-supplied text (tags, names, room codes)
 * into HTML. Anywhere we swapped a textContent call for innerHTML in order to
 * show an icon, this keeps user data from becoming markup.
 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}
