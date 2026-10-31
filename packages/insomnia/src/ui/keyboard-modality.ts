// Whether the keyboard is what's in use, as data-keyboard on the root element,
// for the focus ring. :focus-visible alone isn't enough: react-aria's tabs and
// lists move the focus themselves on a click, which Chromium counts as visible
export const trackKeyboardModality = (root: HTMLElement = document.documentElement) => {
  const keyboard = (event: KeyboardEvent) => {
    // a modifier alone, or a shortcut, isn't moving around the app
    if (event.metaKey || event.ctrlKey || event.altKey || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
      return;
    }
    root.setAttribute('data-keyboard', '');
  };
  const pointer = () => root.removeAttribute('data-keyboard');
  document.addEventListener('keydown', keyboard, true);
  document.addEventListener('pointerdown', pointer, true);
  return () => {
    document.removeEventListener('keydown', keyboard, true);
    document.removeEventListener('pointerdown', pointer, true);
  };
};
