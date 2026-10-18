import type { Control } from './controls.js';
import { element } from './dash.js';

export function fitBottomDeck(deck: HTMLElement, content: HTMLElement): void {
  content.style.transform = 'none';
  content.style.width = '100%';
  const limit = Number.parseFloat(getComputedStyle(deck).maxHeight);
  const scale = Math.min(1, limit / Math.max(1, content.getBoundingClientRect().height));
  content.style.transform = `scale(${scale})`;
  content.style.width = `${100 / scale}%`;
  deck.style.height = `${Math.min(limit, content.getBoundingClientRect().height)}px`;
}

export function installPresenter(
  run: (commands: Control[]) => Promise<void>,
  start: () => void,
  mute: () => void,
  busy: () => boolean,
  onError: (message: string) => void,
): () => void {
  const details = element('detail-panel');
  const detailsToggle = element('details-toggle');
  const rail = element('tuning-rail');
  const railToggle = element('tuning-toggle');
  const deck = element('bottom-deck');
  const deckContent = element('deck-content');
  let fitFrame = 0;
  const fit = () => {
    fitFrame = 0;
    fitBottomDeck(deck, deckContent);
  };
  const scheduleFit = () => {
    if (!fitFrame) fitFrame = requestAnimationFrame(fit);
  };
  const resize = new ResizeObserver(scheduleFit);
  resize.observe(deckContent);
  window.addEventListener('resize', scheduleFit);
  let presenting = false;
  let collapsed = false;
  const showDetails = (show: boolean) => {
    details.hidden = !show;
    detailsToggle.setAttribute('aria-expanded', String(show));
    if (show) element('details-close').focus();
    else detailsToggle.focus();
  };
  const layout = () => {
    rail.hidden = presenting || collapsed;
    document.body.classList.toggle('presenting', presenting);
    document.body.classList.toggle('rail-hidden', rail.hidden);
    element('scenario-caption').hidden = !rail.hidden;
    element('presenter').setAttribute('aria-pressed', String(presenting));
    railToggle.setAttribute('aria-expanded', String(!rail.hidden));
    railToggle.textContent = rail.hidden ? 'Controls [T]' : 'Controls [T] / Hide';
  };
  const toggleRail = () => {
    collapsed = !rail.hidden;
    presenting = false;
    layout();
    railToggle.focus();
  };
  const togglePresenter = () => {
    presenting = !presenting;
    if (!presenting) collapsed = false;
    else if (!details.hidden) showDetails(false);
    layout();
  };
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
    if (key === 'p') togglePresenter();
    else if (key === 't') toggleRail();
    else if (key === 'm') mute();
    else if (key === 'f') void fullscreen();
    else if (!busy() && key === ' ') { event.preventDefault(); start(); }
    else if (!busy() && key === 'r') {
      void run([{ command: 'reset' }]).catch((error: unknown) =>
        onError(error instanceof Error ? error.message : 'Reset failed.'));
    }
  };
  const removers: (() => void)[] = [];
  const click = (node: HTMLElement, handler: () => void) => {
    node.addEventListener('click', handler);
    removers.push(() => node.removeEventListener('click', handler));
  };
  click(element('presenter'), togglePresenter);
  click(railToggle, toggleRail);
  click(detailsToggle, () => showDetails(details.hidden === true));
  click(element('details-close'), () => showDetails(false));
  click(element('fullscreen'), () => { void fullscreen(); });
  document.addEventListener('keydown', onKey);
  layout();
  fit();
  return () => {
    cancelAnimationFrame(fitFrame);
    resize.disconnect();
    window.removeEventListener('resize', scheduleFit);
    document.removeEventListener('keydown', onKey);
    for (const remove of removers) remove();
  };
}
