/** Character pools used by the font-symbol module type. */

/**
 * Default pool when «Строка символов» is empty: readable letters, digits and
 * punctuation only — no technical or invisible glyphs.
 */
export const READABLE_CHAR_POOL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ' +
  '0123456789' +
  '.,:;!?/+-=';

/**
 * Circle- or dot-like at module scale — indistinguishable from a plain oval,
 * so they are never used as font modules.
 *
 * Latin/Cyrillic «О» and digit «0» stay drawable: they remain readable at
 * module scale and must not be filtered out.
 */
export const RANDOM_EXCLUDED_CHARS = new Set('Qq.°,;·•●◦∙');

/** Always kept in the font-symbol pool even if a filter would drop them. */
export const KEEP_FONT_MODULE_CHARS = new Set(['O', 'О', '0']);
