import { captions, presetCommands } from './controls.js';
import type { Control } from './controls.js';
import { element } from './dash.js';

export function installPresenter(
  run: (commands: Control[]) => Promise<void>,
  start: () => void,
  mute: () => void,
  busy: () => boolean,
  onError: (message: string) => void,
): () => void {
  let moment = 0;
  let alternate = false;
  let selecting = false;
  const choose = async (next: number) => {
    if (busy() || selecting) return;
    selecting = true;
    const nextAlternate = next === 2 && moment === 2 ? !alternate : false;
    try {
      await run(presetCommands(next, nextAlternate));
      moment = next;
      alternate = nextAlternate;
      const caption = `${captions[next - 1]}${alternate ? ' Contrast: threshold 0.50.' : ''}`;
      element('caption').dataset.message = caption;
      element('caption').textContent = `${caption} Press Start.`;
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
        button.setAttribute('aria-pressed', String(Number(button.dataset.preset) === next));
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Presenter preset failed.');
    } finally {
      selecting = false;
    }
  };
  const details = element('detail-panel');
  const detailsToggle = element('details-toggle');
  const showDetails = (show: boolean) => {
    details.hidden = !show;
    document.body.classList.toggle('presenting', !show);
    element('presenter').setAttribute('aria-pressed', String(!show));
    detailsToggle.setAttribute('aria-expanded', String(show));
    if (show) element('details-close').focus();
    else detailsToggle.focus();
  };
  const toggle = () => showDetails(details.hidden === true);
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Fullscreen is unavailable.');
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !details.hidden) {
      event.preventDefault();
      showDetails(false);
      return;
    }
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        (event.target instanceof HTMLElement &&
          (event.target.matches('input, select, textarea') || event.target.isContentEditable))) return;
    const key = event.key.toLowerCase();
    if (key === ' ' && event.target instanceof HTMLElement && event.target.matches('button, a, summary')) return;
    if (['1', '2', '3', '4'].includes(key)) { event.preventDefault(); void choose(Number(key)); }
    else if (key === 'p') toggle();
    else if (key === 'm') mute();
    else if (key === 'f') void fullscreen();
    else if (!busy() && !selecting && key === ' ') { event.preventDefault(); start(); }
    else if (!busy() && !selecting && key === 'r') {
      void run([{ command: 'reset' }]).catch((error: unknown) =>
        onError(error instanceof Error ? error.message : 'Reset failed.'));
    }
  };
  const removers: (() => void)[] = [];
  const click = (node: HTMLElement, handler: () => void) => {
    node.addEventListener('click', handler);
    removers.push(() => node.removeEventListener('click', handler));
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
    click(button, () => { void choose(Number(button.dataset.preset)); });
  }
  click(element('presenter'), toggle);
  click(detailsToggle, toggle);
  click(element('details-close'), () => showDetails(false));
  click(element('fullscreen'), () => { void fullscreen(); });
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('keydown', onKey);
    for (const remove of removers) remove();
  };
}
