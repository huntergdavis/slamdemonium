import playbook from '../../docs/TUNING_PLAYBOOK.md?raw';
import { PARAM_DEFS, type ParamGroup, type ParamKey } from '../tuning/schema';
import { ParamControl, node } from './paramControl';
import { TireCurvePlot, type TirePlotTelemetry } from './tireCurvePlot';
import { TuningSession } from './tuningSession';

const GROUP_ORDER: readonly ParamGroup[] = [
  'World',
  'Chassis',
  'Engine',
  'Brakes',
  'Tires',
  'Steering',
  'Suspension',
  'Boost & Drift',
  'Collision',
  'Camera',
  'Input',
];
// Preserve the established navigation order, then include every new schema group.
const GROUPS = [
  ...new Set([...GROUP_ORDER, ...PARAM_DEFS.map((def) => def.group)]),
];
interface GroupView {
  element: HTMLDetailsElement;
  advanced: HTMLDetailsElement;
  controls: ParamControl[];
}

export class OptionsGroups {
  readonly quick: HTMLDetailsElement;
  readonly plot: TireCurvePlot;
  readonly tires: HTMLDetailsElement;
  private readonly controls = new Map<ParamKey, ParamControl[]>();
  private readonly quickControls: ParamControl[] = [];
  private readonly groups: GroupView[] = [];
  private readonly empty: HTMLElement;
  private readonly log: HTMLDetailsElement;
  private readonly logList: HTMLOListElement;
  private readonly logLabel: Text;
  private logIndex = 0;
  private readonly beforeSearch = new Map<HTMLDetailsElement, boolean>();

  constructor(
    host: HTMLElement,
    private readonly session: TuningSession,
    drivingSurface: HTMLElement,
    readTelemetry?: () => TirePlotTelemetry | undefined,
  ) {
    const doc = host.ownerDocument;
    this.quick = node(doc, 'details', 'sl-options__quick');
    this.quick.open = true;
    this.quick.append(node(doc, 'summary', '', 'Quick Tune (14)'));
    const quickBody = node(doc, 'div', 'sl-group__body');
    this.quick.append(quickBody);
    host.append(this.quick);
    for (const definition of PARAM_DEFS) {
      if (!definition.quick) continue;
      const control = new ParamControl(
        quickBody,
        definition,
        session,
        'quick',
        drivingSurface,
      );
      this.register(control);
      this.quickControls.push(control);
    }
    const groupHost = node(doc, 'div', 'sl-options__groups');
    host.append(groupHost);
    const collapse = node(doc, 'button', 'sl-button', 'Collapse all groups');
    collapse.type = 'button';
    collapse.addEventListener('click', () => {
      for (const group of this.groups) {
        group.element.open = false;
        group.advanced.open = false;
      }
    });
    groupHost.append(collapse);
    this.empty = node(doc, 'p', 'sl-empty', 'No matching controls');
    this.empty.hidden = true;
    groupHost.append(this.empty);
    let plot: TireCurvePlot | undefined;
    let tires: HTMLDetailsElement | undefined;
    for (const groupName of GROUPS) {
      const group = node(doc, 'details', 'sl-group');
      group.dataset.group = groupName;
      group.append(node(doc, 'summary', '', groupName));
      const body = node(doc, 'div', 'sl-group__body');
      const actions = node(doc, 'div', 'sl-group__actions');
      const reset = node(doc, 'button', 'sl-button', 'Reset group');
      reset.type = 'button';
      reset.setAttribute('aria-label', 'Reset ' + groupName + ' group');
      reset.addEventListener('click', () => {
        session.store.resetGroup(groupName);
      });
      actions.append(reset);
      body.append(actions);
      group.append(body);
      groupHost.append(group);
      if (groupName === 'Tires') {
        group.open = true;
        tires = group;
        plot = new TireCurvePlot(body, session.store, readTelemetry);
      }
      const advanced = node(doc, 'details', 'sl-group');
      advanced.dataset.advanced = 'true';
      advanced.append(node(doc, 'summary', '', 'Advanced'));
      const advancedBody = node(doc, 'div', 'sl-group__body');
      advanced.append(advancedBody);
      const controls: ParamControl[] = [];
      let hasAdvanced = false;
      for (const definition of PARAM_DEFS) {
        if (definition.group !== groupName) continue;
        const control = new ParamControl(
          definition.advanced ? advancedBody : body,
          definition,
          session,
          'group',
          drivingSurface,
        );
        hasAdvanced ||= definition.advanced === true;
        controls.push(control);
        this.register(control);
      }
      if (hasAdvanced) body.append(advanced);
      this.groups.push({ element: group, advanced, controls });
    }
    if (!plot || !tires)
      throw new Error('Schema must include the Tires group.');
    this.plot = plot;
    this.tires = tires;
    const guide = node(doc, 'details', 'sl-group');
    guide.append(node(doc, 'summary', '', 'Tuning playbook'));
    const guideBody = node(doc, 'div', 'sl-group__body');
    const table =
      playbook.split('## Symptom to slider')[1]?.split('###')[0] ?? '';
    for (const row of table.split('\n')) {
      if (!row.startsWith('| ') || row.startsWith('| Symptom')) continue;
      const cells = row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.length !== 2) continue;
      const paragraph = node(doc, 'p');
      paragraph.append(
        node(doc, 'strong', '', cells[0] ?? ''),
        doc.createTextNode(': ' + (cells[1] ?? '').replace(/`/g, '')),
      );
      guideBody.append(paragraph);
    }
    guide.append(guideBody);
    groupHost.append(guide);
    this.log = node(doc, 'details', 'sl-group');
    this.log.append(node(doc, 'summary', '', 'Change log'));
    const logBody = node(doc, 'div', 'sl-group__body');
    const caption = node(doc, 'p', 'sl-caption');
    this.logLabel = doc.createTextNode('No changes yet.');
    caption.append(this.logLabel);
    this.logList = node(doc, 'ol', 'sl-caption');
    logBody.append(caption, this.logList);
    this.log.append(logBody);
    groupHost.append(this.log);
    this.log.addEventListener('toggle', () => {
      this.updateLog();
    });
  }

  sync(key?: ParamKey): void {
    if (key) {
      for (const control of this.controls.get(key) ?? []) control.sync();
      // A rebuild applies to the entire body's mass properties.
      if (this.session.rebuildState !== 'idle') {
        for (const controls of this.controls.values())
          for (const control of controls)
            if (control.definition.needsRebuild) control.sync();
      }
    } else {
      for (const controls of this.controls.values())
        for (const control of controls) control.sync();
    }
    this.updateLog();
  }

  search(query: string): void {
    query = query.trim().toLowerCase();
    if (query && this.beforeSearch.size === 0) {
      this.beforeSearch.set(this.quick, this.quick.open);
      for (const group of this.groups) {
        this.beforeSearch.set(group.element, group.element.open);
        this.beforeSearch.set(group.advanced, group.advanced.open);
      }
    }
    let quickMatches = 0;
    for (const control of this.quickControls) {
      control.element.hidden = !control.searchText.includes(query);
      if (!control.element.hidden) quickMatches++;
    }
    this.quick.hidden = quickMatches === 0;
    if (query && quickMatches) this.quick.open = true;
    let matches = 0;
    for (const group of this.groups) {
      let groupMatches = 0,
        advancedMatches = 0;
      for (const control of group.controls) {
        control.element.hidden = !control.searchText.includes(query);
        if (!control.element.hidden) {
          groupMatches++;
          if (control.definition.advanced) advancedMatches++;
        }
      }
      matches += groupMatches;
      group.element.hidden = groupMatches === 0;
      group.advanced.hidden = advancedMatches === 0;
      if (query && groupMatches) group.element.open = true;
      if (query && advancedMatches) group.advanced.open = true;
    }
    this.empty.hidden = matches !== 0;
    if (!query) {
      for (const [details, open] of this.beforeSearch) details.open = open;
      this.beforeSearch.clear();
    }
  }

  dispose(): void {
    this.plot.dispose();
  }

  private register(control: ParamControl): void {
    const existing = this.controls.get(control.definition.key);
    if (existing) existing.push(control);
    else this.controls.set(control.definition.key, [control]);
  }

  private updateLog(): void {
    if (!this.log.open) return;
    const count = this.session.persistence.changeLogLength;
    // Bound DOM cost for long tuning sessions; JSON export retains the complete log.
    this.logIndex = Math.max(this.logIndex, count - 200);
    while (this.logIndex < count) {
      const entry = this.session.persistence.changeLogEntry(this.logIndex++);
      if (!entry) continue;
      this.logList.append(
        node(
          this.log.ownerDocument,
          'li',
          '',
          `${new Date(entry.timestamp).toLocaleTimeString()} · ${entry.key}: ${entry.old} → ${entry.new}`,
        ),
      );
      while (this.logList.childElementCount > 200)
        this.logList.firstElementChild?.remove();
    }
    this.logLabel.nodeValue = count
      ? `${count} changes. Showing the latest ${Math.min(count, 200)}; export includes all.`
      : 'No changes yet.';
  }
}
