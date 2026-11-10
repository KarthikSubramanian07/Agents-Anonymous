# Accessibility

Agents Anonymous aims to meet **WCAG 2.2 Level AA** on every page of the site.

## What was tested (November 2026)

- **Automated:** axe-core 4.14 with the WCAG 2.0, 2.1 and 2.2 A/AA rules, in headless Chrome at
  1440×900, 390×844 and 320×800, on every route (including 404, a share page, a missing share, and the
  share template) and on these states: the small-screen menu open, intake with an empty submit, with
  results and with the share dialog open, the Meeting re-sorted and an empty room, and the game started,
  paused, showing a new-habit card, and over (normal and daily). Zero violations.
- **By hand, over the DevTools protocol:** keyboard order and focus visibility with scripted Tab
  presses, the accessibility tree for names, roles and states, dialogs taking and returning focus,
  Escape, live announcements, contrast of text, focus rings and states, reflow at 320 px, text spacing,
  target sizes, and reduced motion.

## How the site handles it

- One focus ring everywhere: amber on the dark pages, ink on the paper ones.
- "Pause animations" (in the footer, and in the home page hero) freezes every looping animation and
  the rotating quotes, is remembered, and starts on for anyone whose system asks for reduced motion.
- Defend the Circle is fully playable from the keyboard: every chair on the canvas has a button laid
  over it, waves, placements and leaks are announced, and the single-key shortcuts only work while
  focus is inside the game.

## Known limitations

- The game board is a canvas. A screen reader gets each chair's contents and the game's events, but
  not the positions of the habits walking toward the table; the game is real-time, and P pauses it.
- On the home page, clicking a chair in the illustration picks whose story is shown. That is a mouse
  extra; the same stories are all on the Meeting page.
- The rubber-stamp verdict on a diagnosis has a deliberate ink texture. Its colours pass 4.5:1, but the
  texture thins the letters; the same verdict is in the score and the summary line above it.

## Reporting a barrier

Open an issue at <https://github.com/KarthikSubramanian07/Agents-Anonymous/issues> with the page, what
you were trying to do, and the browser and assistive technology you use. Accessibility issues are
treated as bugs.
