/* dashboard/public/theme.js
 * -----------------------------------------------------------------------
 * Shared dark/light theme switcher for every dashboard page.
 *
 * Loaded early in <head>, right after style.css, on every page (including
 * login.html). Applies the saved theme to <html data-theme="..."> BEFORE
 * the page paints, so there's no flash of the wrong theme. The actual
 * color values live in style.css as CSS variables (:root = dark,
 * html[data-theme="light"] = light overrides) — this file only decides
 * which one is active and remembers the choice.
 * ------------------------------------------------------------------- */
(function () {
    var STORAGE_KEY = "asta-dashboard-theme";

    function getSavedTheme() {
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved === "light" || saved === "dark") return saved;
        } catch (e) { /* localStorage unavailable — fall through to default */ }
        return "dark";
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* ignore */ }
    }

    // Apply immediately, before body paints.
    applyTheme(getSavedTheme());

    window.AstaTheme = {
        get: function () {
            return document.documentElement.getAttribute("data-theme") || "dark";
        },
        set: applyTheme,
        toggle: function () {
            var next = window.AstaTheme.get() === "dark" ? "light" : "dark";
            applyTheme(next);
            return next;
        },
    };
})();
