// Theme Management
const THEME_KEY = 'gym-tracker-theme';

function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(savedTheme);
}

function applyTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem(THEME_KEY, themeName);

    // Sync the UI selector if it exists
    const selector = document.getElementById('theme-select');
    if (selector) {
        selector.value = themeName;
    }
}

function bindThemeSelector() {
    const selector = document.getElementById('theme-select');
    if (!selector) return;

    selector.addEventListener('change', (e) => {
        applyTheme(e.target.value);
    });
}

// Initialize theme as soon as possible to avoid flash of wrong theme
initTheme();

document.addEventListener('DOMContentLoaded', () => {
    bindThemeSelector();
});
