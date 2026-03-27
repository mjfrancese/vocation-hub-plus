/**
 * Detect gibberish text in profile fields.
 * Some VH profiles contain random keyboard mashing like "m;jEBE;GB;EEBG"
 * or ">nbfbnb'bn" in detail fields.
 */

export function isGibberish(value: string): boolean {
  if (!value || value.length < 5) return false;

  const stripped = value.replace(/\s/g, '');
  if (stripped.length === 0) return true;

  // Pure numbers, currency, or dates are not gibberish
  if (/^[\d$,./\-()%+]+$/.test(stripped)) return false;

  // URLs are not gibberish
  if (/^https?:\/\//i.test(value.trim())) return false;

  // Email-like values are not gibberish
  if (/^[\w.+-]+@[\w.-]+\.\w+/.test(value.trim())) return false;

  // "Yes", "No", "N/A", short known values
  if (/^(yes|no|n\/a|none|na|tbd|half|full|standard)$/i.test(value.trim())) return false;

  const alpha = stripped.replace(/[^a-zA-Z]/g, '').length;
  const total = stripped.length;

  // High non-alpha ratio (over 50% special chars in non-numeric text)
  if (total > 6 && alpha / total < 0.5) return true;

  // Very low vowel ratio for strings that should be English
  if (alpha > 8) {
    const vowels = stripped.replace(/[^aeiouAEIOU]/g, '').length;
    if (vowels / alpha < 0.1) return true;
  }

  // Multiple consecutive special characters (like ";jEBE;GB;EEBG")
  if (/[;><'"]{2,}/.test(value)) return true;

  return false;
}

/**
 * Filter gibberish values from a field, returning empty string if gibberish.
 */
export function cleanFieldValue(value: string): string {
  return isGibberish(value) ? '' : value;
}
