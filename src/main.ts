import { GAME_NAME } from './core/constants';
import { createGameStub } from './core/gameApi';
import { createRenderer } from './render/renderer';
import './style.css';

document.title = GAME_NAME;
const host = document.querySelector<HTMLElement>('#app');
if (!host) throw new Error('Missing game mount element.');
host.setAttribute('aria-label', GAME_NAME);

const game = createGameStub();
window.__game = game;
const view = createRenderer(host);
let frameId = 0;

function frame(): void {
  view.render();
  game.ready = true;
  frameId = requestAnimationFrame(frame);
}

frameId = requestAnimationFrame(frame);
import.meta.hot?.dispose(() => {
  cancelAnimationFrame(frameId);
  game.ready = false;
  view.dispose();
});
