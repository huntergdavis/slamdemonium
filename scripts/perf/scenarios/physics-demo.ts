import type { PerfScenario } from '../scenario.ts';

const scenario: PerfScenario = {
  name: 'vehicle-procedural',
  description:
    'WP5 vehicle/test track; fresh spawn before each complete procedural replay. Not a scripted lap.',
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
