// The captain's chair.
//
// Built from what the chair actually had, which is documented in
// docs/RESEARCH.md and is shorter than you would expect: of all the buttons on
// the prop, exactly three were ever assigned a function on screen — yellow
// alert, red alert, and jettison the ion pod. The rest of the layout is
// recorded as a shape rather than a spec: a row of flip switches and shuttle,
// viewscreen and hailing controls on the left arm; alerts, the pod, a
// micro-tape player and the intercom on the right.
//
// So this panel reproduces the three documented controls exactly, fills the
// rest from the documented shape, and adds nothing that the simulation cannot
// actually do. Every control here emits the same order object the parser
// produces from typed text, which means there is one execution path and not
// two — a control that works from the chair works from the keyboard, and a
// control that breaks, breaks in both places at once where a test can see it.
//
// The research also notes that the arrangement changed episode to episode as
// the script required. That is licence, taken here: what the chair offers
// depends on the alert condition and on whether anyone is shooting at you.

import { el, button, panel } from './lcars.js';
import { audio } from '../audio/engine.js';
import { haptic } from './touch.js';

/** Departments reachable on the intercom, in the order the stations ring the bridge. */
export const INTERCOM_STATIONS = [
  { id: 'engineering', label: 'Engineering' },
  { id: 'tactical', label: 'Tactical' },
  { id: 'science', label: 'Science' },
  { id: 'medical', label: 'Sickbay' },
  { id: 'helm', label: 'Helm' },
  { id: 'comms', label: 'Comms' },
  { id: 'security', label: 'Security' },
];

const ALERTS = [
  { level: 'red', label: 'Red alert', color: 'red', sub: 'Battle stations' },
  { level: 'yellow', label: 'Yellow alert', color: 'amber', sub: 'Increased readiness' },
  { level: 'blue', label: 'Blue alert', color: 'blue', sub: 'Docking and maintenance stations' },
  { level: 'normal', label: 'Stand down', color: 'ghost', sub: 'Condition green' },
];

function press(app, order, cue = 'ui_confirm', feel = 'tap') {
  return () => {
    audio.play(cue);
    haptic(feel);
    app.executeOrder(order, order.chairLabel ?? 'chair control');
    app.render();
  };
}

/**
 * The chair panel. Rendered on the bridge and in an engagement, because that is
 * where you are sitting in it.
 */
export function chairPanel(app) {
  const g = app.game;
  const inCombat = !!g.engagement && !g.engagement.over;

  // ---- Right arm: the three labelled controls, plus the intercom ----
  const alerts = ALERTS
    .filter((a) => !(a.level === 'blue' && inCombat))
    .map((a) => button(a.label, press(app, { action: 'alert', level: a.level, chairLabel: a.label }), {
      color: g.alert === a.level ? 'green' : a.color,
      sub: g.alert === a.level ? 'Current condition' : a.sub,
    }));

  const pod = button('Jettison ion pod', press(app, { action: 'jettison_pod', chairLabel: 'jettison the pod' }, 'ui_deny', 'deny'), {
    color: 'peach',
    sub: inCombat ? 'Decoy — reads like us for about a minute' : 'Nothing to gain outside a fight',
    disabled: !inCombat || g.podJettisoned,
  });

  // ---- Left arm: viewscreen, hailing frequencies, shuttle bay ----
  const left = [
    button('Viewscreen', press(app, { action: 'viewscreen', chairLabel: 'on screen' }, 'ui_tap'), {
      color: 'ice',
      sub: app.screen === 'tactical' ? 'Return to the bridge' : 'Tactical display',
    }),
    button('Hailing frequencies', press(app, { action: 'hail', chairLabel: 'hailing frequencies open' }), {
      color: 'blue',
      sub: 'Open a channel',
    }),
  ];

  // ---- The recorder ----
  // Deliberately not `.orderline`: that class belongs to the order input in
  // the shell, and two elements sharing it makes "type an order" ambiguous for
  // anything selecting by class — including the browser harness.
  const logInput = el('input', {
    class: 'logline',
    type: 'text',
    placeholder: 'Captain’s log, supplemental…',
    'aria-label': 'Captain’s log entry',
  });
  const record = () => {
    const text = logInput.value.trim();
    if (!text) return;
    logInput.value = '';
    audio.play('computer_ack');
    haptic('confirm');
    app.executeOrder({ action: 'log_entry', text }, text);
    app.render();
  };
  logInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') record(); });

  return panel('Command Chair', [
    el('div', { class: 'chair-arm' }, alerts),
    el('div', { class: 'chair-arm' }, left),
    pod,
    el('div', { class: 'chair-intercom' }, [
      el('div', { class: 'label', text: 'Intercom' }),
      el('div', { class: 'chair-stations' }, INTERCOM_STATIONS.map((s) =>
        button(s.label, press(app, { action: 'intercom', dept: s.id, chairLabel: `${s.label}, report` }, 'computer_query'), {
          color: 'ghost',
        }))),
    ]),
    el('div', { class: 'chair-recorder' }, [
      logInput,
      button('Record', record, { color: 'amber' }),
    ]),
  ], 'chair');
}
