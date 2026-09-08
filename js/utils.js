// Shared utilities for gym-tracker (loaded before all other app scripts)

/**
 * Formats a Date as a local-timezone YYYY-MM-DD string (e.g. "2025-06-14").
 * Unlike toISOString(), this does not shift the date into UTC, so it stays
 * correct for users in timezones ahead of UTC during evening hours.
 */
function toLocalISODate(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Escapes HTML special characters so untrusted strings (exercise names,
 * error messages) can be safely interpolated into innerHTML templates.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
