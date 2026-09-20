import type { PerfScenario } from '../scenario.ts';

const scenario: PerfScenario = {
  name: 'physics-demo',
  description:
    'WP1 box/plane/wall; fresh spawn before each complete procedural replay. Not a vehicle lap.',
  async setup(page) {
    await page.evaluate(() => {
      const game = window.__game;
      game.setInput({
        throttle: 0,
        brake: 0,
        steer: 0,
        handbrake: false,
        boost: false,
      });
      game.respawn();
    });
  },
};

export default scenario;
