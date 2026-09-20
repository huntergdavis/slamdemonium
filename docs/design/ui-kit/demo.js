/* global document, requestAnimationFrame, cancelAnimationFrame */
// Review-page behavior only. WP7 owns real store, presets and persistence.
const root = document.body;
const panel = document.querySelector('#kit-options');
const main = document.querySelector('#kit-main');
const opener = document.querySelector('#open-options');
const status = document.querySelector('#demo-status');
const fields = [...document.querySelectorAll('.sl-field')].map((element) => ({
  element,
  number: element.querySelector('.sl-field__number'),
  range: element.querySelector('.sl-field__range'),
  help: element.querySelector('.sl-field__help'),
  tooltip: element.querySelector('.sl-tooltip'),
  error: element.querySelector('.sl-field__error'),
  pinned: false,
}));
let activeSlot = 'A';
const slots = { A: {}, B: {} };
function setPanel(open) {
  root.dataset.optionsOpen = String(open);
  panel.dataset.open = String(open);
  panel.inert = !open;
  panel.setAttribute('aria-hidden', String(!open));
  opener.setAttribute('aria-expanded', String(open));
  (open ? document.querySelector('#close-options') : opener).focus();
}
opener.addEventListener('click', () => setPanel(true));
document
  .querySelector('#close-options')
  .addEventListener('click', () => setPanel(false));
function setHelp(field, show) {
  field.tooltip.hidden = !show;
  field.help.setAttribute('aria-expanded', String(show));
}
function setField(field, value) {
  if (!Number.isFinite(value)) {
    field.number.setAttribute('aria-invalid', 'true');
    field.error.hidden = false;
    return;
  }
  const clamped = Math.max(
    Number(field.number.min),
    Math.min(Number(field.number.max), value),
  );
  field.number.value = String(clamped);
  field.range.value = String(clamped);
  field.element.dataset.edited = String(
    clamped !== Number(field.element.dataset.baseline),
  );
  field.number.removeAttribute('aria-invalid');
  field.error.hidden = true;
  slots[activeSlot][field.element.dataset.key] = clamped;
}
for (const field of fields) {
  slots.A[field.element.dataset.key] = Number(field.number.value);
  slots.B[field.element.dataset.key] = Number(field.element.dataset.default);
  field.range.addEventListener('input', () =>
    setField(field, field.range.valueAsNumber),
  );
  field.number.addEventListener('input', () =>
    setField(field, field.number.valueAsNumber),
  );
  field.range.addEventListener('pointerup', () => {
    field.range.blur();
    main.focus({ preventScroll: true });
  });
  field.element
    .querySelector('.sl-field__reset')
    .addEventListener('click', () =>
      setField(field, Number(field.element.dataset.default)),
    );
  field.help.addEventListener('focus', () => setHelp(field, true));
  field.help.addEventListener('blur', () => {
    if (!field.pinned) setHelp(field, false);
  });
  field.help.addEventListener('mouseenter', () => setHelp(field, true));
  field.help.addEventListener('mouseleave', () => {
    if (!field.pinned && document.activeElement !== field.help)
      setHelp(field, false);
  });
  field.help.addEventListener('click', () => {
    field.pinned = !field.pinned;
    setHelp(field, field.pinned);
  });
}
function setSlot(slot) {
  activeSlot = slot;
  for (const name of ['A', 'B']) {
    const button = document.querySelector('#slot-' + name.toLowerCase());
    button.textContent = name === slot ? name + ' ACTIVE' : name;
    button.setAttribute('aria-pressed', String(name === slot));
  }
  for (const field of fields)
    setField(field, slots[slot][field.element.dataset.key]);
  document.querySelector('#hud-slot').firstChild.nodeValue = slot + ' ACTIVE';
}
document.querySelector('#slot-a').addEventListener('click', () => setSlot('A'));
document.querySelector('#slot-b').addEventListener('click', () => setSlot('B'));
document.querySelector('#copy-slot').addEventListener('click', () => {
  Object.assign(slots.B, slots.A);
  if (activeSlot === 'B') setSlot('B');
  status.textContent = 'Copied A to B';
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && document.activeElement === main) {
    event.preventDefault();
    setSlot(activeSlot === 'A' ? 'B' : 'A');
  }
  if (event.key === 'Escape') {
    const help = fields.find((field) => !field.tooltip.hidden);
    if (help) {
      help.pinned = false;
      setHelp(help, false);
    } else if (panel.dataset.open === 'true') setPanel(false);
  }
});
const groups = [...document.querySelectorAll('.sl-group')];
document.querySelector('#collapse-groups').addEventListener('click', () => {
  for (const group of groups) group.open = false;
});
document.querySelector('#search').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase();
  let count = 0;
  for (const field of fields) {
    const match =
      !query ||
      (
        field.element.dataset.key +
        ' ' +
        field.element.querySelector('label').textContent
      )
        .toLowerCase()
        .includes(query);
    field.element.hidden = !match;
    if (match) count++;
  }
  for (const group of groups) {
    group.hidden =
      Boolean(query) && !group.querySelector('.sl-field:not([hidden])');
    if (query && !group.hidden) group.open = true;
  }
  const quick = document.querySelector('.sl-options__quick');
  quick.hidden =
    Boolean(query) && !quick.querySelector('.sl-field:not([hidden])');
  if (query && !quick.hidden) quick.open = true;
  document.querySelector('#search-empty').hidden = count > 0;
});
for (const group of groups) {
  group.querySelector('.sl-group__reset')?.addEventListener('click', () => {
    for (const field of fields)
      if (group.contains(field.element))
        setField(field, Number(field.element.dataset.default));
  });
}
document.querySelector('#reset-all').addEventListener('click', () => {
  for (const field of fields)
    setField(field, Number(field.element.dataset.default));
  status.textContent = 'Sample values reset';
});
document.querySelector('#preset').addEventListener('change', () => {
  status.textContent = 'Preset styling preview; game applies real presets';
});

// Cache text nodes and elements once. The rate gate precedes every sample read.
const speedNode = document.querySelector('#speed').firstChild;
const speedMsNode = document.querySelector('#speed-ms').firstChild;
const slideNode = document.querySelector('#slide-value').firstChild;
const slideGauge = document.querySelector('#slide-gauge');
const boostNode = document.querySelector('#boost-value').firstChild;
const boostMeter = document.querySelector('#boost-meter');
const driftMeter = document.querySelector('.sl-meter--drift');
const driftNode = driftMeter.querySelector('.sl-meter__value').firstChild;
const chargeMeters = [boostMeter, driftMeter];
const chargeBadges = [...document.querySelectorAll('[data-state="charging"]')];
const animate = document.querySelector('#animate');
const pauseOpen = document.querySelector('#pause-open');
let running = false;
let frameId = 0;
let lastSampleMs = -Infinity;
function frame(nowMs) {
  if (!running) return;
  frameId = requestAnimationFrame(frame);
  if (document.hidden || (pauseOpen.checked && panel.dataset.open === 'true'))
    return;
  if (nowMs - lastSampleMs < 1000 / 30) return;
  lastSampleMs = nowMs;
  const speed = 55 + Math.sin(nowMs / 900) * 8;
  const beta = Math.sin(nowMs / 1400) * 35;
  const charge = 62 + Math.sin(nowMs / 2000) * 20;
  speedNode.nodeValue = String(Math.round(speed * 3.6));
  speedMsNode.nodeValue = speed.toFixed(1);
  slideNode.nodeValue = (beta >= 0 ? '+' : '') + Math.round(beta) + '°';
  slideGauge.style.setProperty(
    '--sl-position',
    ((beta + 90) / 180) * 100 + '%',
  );
  slideGauge.setAttribute('aria-valuenow', beta.toFixed(1));
  slideGauge.setAttribute(
    'aria-valuetext',
    Math.abs(beta).toFixed(1) + ' degrees ' + (beta >= 0 ? 'right' : 'left'),
  );
  boostNode.nodeValue = Math.round(charge) + '%';
  driftNode.nodeValue = Math.round(charge) + '%';
  for (const meter of chargeMeters) {
    meter.style.setProperty('--sl-fill', String(charge / 100));
    meter.setAttribute('aria-valuenow', charge.toFixed(1));
  }
  for (const badge of chargeBadges) {
    badge.dataset.state = Math.abs(beta) >= 12 ? 'charging' : 'ready';
    badge.firstChild.nodeValue =
      Math.abs(beta) >= 12 ? '● CHARGING' : 'DRIFT READY';
  }
}
animate.addEventListener('click', () => {
  running = !running;
  animate.setAttribute('aria-pressed', String(running));
  animate.textContent = running
    ? 'Stop sample animation'
    : 'Animate sample values';
  cancelAnimationFrame(frameId);
  if (running) frameId = requestAnimationFrame(frame);
});

function drawGraphs() {
  const colors = globalThis.getComputedStyle(root);
  const color = (token) => colors.getPropertyValue('--sl-' + token).trim();
  for (const id of ['gg-canvas', 'tire-canvas', 'history-canvas']) {
    const canvas = document.querySelector('#' + id);
    if (!canvas.clientWidth) continue;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = color('border');
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo((i * width) / 5, 0);
      ctx.lineTo((i * width) / 5, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i * height) / 5);
      ctx.lineTo(width, (i * height) / 5);
      ctx.stroke();
    }
    ctx.font = '12px system-ui';
    ctx.fillStyle = color('muted');
    if (id === 'gg-canvas') {
      ctx.strokeStyle = color('muted');
      ctx.beginPath();
      ctx.arc(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.32,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.fillText('+ longitudinal', 12, 18);
      ctx.fillText('+ lateral →', width - 90, height - 12);
      ctx.fillStyle = color('accent');
      ctx.beginPath();
      ctx.arc(width * 0.64, height * 0.35, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillText(
        id === 'tire-canvas' ? '1.0 grip usage' : 'slip angle °',
        10,
        16,
      );
      ctx.fillText(
        id === 'tire-canvas'
          ? '0°                 11°                 44°'
          : '−10 s                                         now',
        10,
        height - 6,
      );
      for (let axle = 0; axle < 2; axle++) {
        ctx.strokeStyle = color(axle ? 'drift' : 'accent');
        ctx.lineWidth = 2;
        ctx.setLineDash(axle ? [5, 4] : []);
        ctx.beginPath();
        for (let i = 0; i <= 120; i++) {
          const x = i / 120;
          const normalized = x * 4;
          const value =
            id === 'tire-canvas'
              ? normalized <= 1
                ? 2 * normalized - normalized ** 2
                : 0.78 + 0.22 * Math.exp(-1.5 * (normalized - 1))
              : 0.45 + 0.2 * Math.sin(x * 10 + axle * 0.8);
          const px = 12 + x * (width - 24),
            py = height - 22 - value * (height - 46);
          if (!i) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  }
}
for (const group of groups) group.addEventListener('toggle', drawGraphs);
globalThis.addEventListener('resize', drawGraphs);
drawGraphs();
