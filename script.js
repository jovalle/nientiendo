const themes = [
  { logo: './assets/logo/white-on-red.svg', background: '#e60012' },
  { logo: './assets/logo/red-on-black.svg', background: '#000000' },
  { logo: './assets/logo/red-on-white.svg', background: '#ffffff' },
  { logo: './assets/logo/white-on-black.svg', background: '#000000' },
  { logo: './assets/logo/black-on-white.svg', background: '#ffffff' },
];

const root = document.documentElement;

function nextThemeIndex(index) {
  return (index + 1) % themes.length;
}

let currentTheme = 0;
let requestedTheme = currentTheme;

root.dataset.theme = String(currentTheme);

document.addEventListener('DOMContentLoaded', () => {
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let transitionSequence = 0;

  function applyTheme(index) {
    currentTheme = index;
    root.dataset.theme = String(index);
    themeColor.content = themes[index].background;
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

  themeColor.content = themes[currentTheme].background;
  document.querySelectorAll('.logo-stage, .theme-trigger').forEach((trigger) => {
    trigger.addEventListener('click', cycleTheme);
  });
});
