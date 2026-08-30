const themes = [
  { logo: './assets/logo/white.svg', background: '#e60012', foreground: '#ffffff' },
  { logo: './assets/logo/red.svg', background: '#000000', foreground: '#e60012' },
  { logo: './assets/logo/red.svg', background: '#ffffff', foreground: '#e60012' },
  { logo: './assets/logo/white.svg', background: '#000000', foreground: '#ffffff' },
  { logo: './assets/logo/black.svg', background: '#ffffff', foreground: '#000000' },
];
const themeMarkPath =
  'M4 3h7l-1 18H5L4 3Zm.75 22h6v6h-6v-6ZM16 11.25C16 5.5 19.75 1.5 25.5 1.5S35 5 35 10.5c0 4.25-2.1 6.4-5.4 8.65-2.1 1.45-2.85 2.5-2.85 4.85h-6c0-4.65 1.75-6.9 5.15-9.25 2.05-1.4 3-2.25 3-4 0-2.35-1.4-3.75-3.65-3.75-2.35 0-3.75 1.55-3.75 4.25H16ZM20.75 25h6v6h-6v-6Z';

const root = document.documentElement;

function nextThemeIndex(index) {
  return (index + 1) % themes.length;
}

let currentTheme = 0;
let requestedTheme = currentTheme;

root.dataset.theme = String(currentTheme);

document.addEventListener('DOMContentLoaded', () => {
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const favicon = document.querySelector('link[rel="icon"]');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let transitionSequence = 0;

  function applyTheme(index) {
    const theme = themes[index];
    currentTheme = index;
    root.dataset.theme = String(index);
    themeColor.content = theme.background;
    favicon.type = 'image/svg+xml';
    favicon.href = `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${theme.background}"/><path fill="${theme.foreground}" transform="translate(0 4)" d="${themeMarkPath}"/></svg>`,
    )}`;
  }

  function cycleTheme() {
    const nextTheme = nextThemeIndex(requestedTheme);
    requestedTheme = nextTheme;

    if (reducedMotion.matches || !document.startViewTransition) {
      applyTheme(nextTheme);
      return;
    }

    const sequence = ++transitionSequence;
    root.classList.add('is-switching');
    const transition = document.startViewTransition(() => applyTheme(nextTheme));

    transition.finished.finally(() => {
      if (sequence === transitionSequence) {
        root.classList.remove('is-switching');
      }
    });
  }

  applyTheme(currentTheme);
  document.querySelectorAll('.logo-stage, .theme-trigger').forEach((trigger) => {
    trigger.addEventListener('click', cycleTheme);
  });
});
