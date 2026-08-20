// Theme Management
const THEME_KEY = 'gym-tracker-theme';
const VERSION_KEY = 'gym-tracker-theme-version';

function initTheme() {
    let savedTheme = localStorage.getItem(THEME_KEY);
    const version = parseInt(localStorage.getItem(VERSION_KEY));
    
    // Migration: old default was "dark" — reset to new "default" if no version set
    if (!version && savedTheme === 'dark') {
        savedTheme = 'default';
    }
    
    const finalTheme = savedTheme || 'default';
    applyTheme(finalTheme);
}

function applyTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem(THEME_KEY, themeName);
    localStorage.setItem(VERSION_KEY, '1');

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
    // After DOM is ready, sync the selector value with the saved theme
    const saved = localStorage.getItem(THEME_KEY) || 'default';
    const sel = document.getElementById('theme-select');
    if (sel) sel.value = saved;
});
