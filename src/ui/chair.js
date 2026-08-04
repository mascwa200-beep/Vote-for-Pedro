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
 * The helm's eight warp flip switches.
 *
 * docs/RESEARCH.md documents them as a real control on the prop: a row of eight
 * below the main helm panel that set the warp factor. Exported because they
 * belong to the HELM, and the helm is a console you walk to — the chair panel
 * shows them too, because the chair is where the order is given from.
 */
export function warpSwitches(app) {
  const g = app.game;
  //
  // Documented in docs/RESEARCH.md as a real control on the prop: a row of
  // eight flip switches below the main helm panel that set the warp factor.
  // The game had a factor picker buried in the system-detail card on the map
  // and nothing on the bridge, so "warp eight" was a thing you could say and
  // then watch the ship leave at six.
  //
  // These set a standing order rather than engaging: you throw the switch, then
  // give the course. Which is how it works — the switches are on the console
  // whether or not there is anywhere to go.
  const maxWarp = g.ship.cls.maxWarp ?? 8;
  const standing = g.warpFactor ?? 6;
  const switches = el('div', { class: 'warp-switches' }, Array.from({ length: 8 }, (_, i) => {
    const f = i + 1;
    const beyond = f > maxWarp;
    const on = Math.round(standing) === f;
    return el('button', {
      class: `warp-switch${on ? ' on' : ''}${beyond ? ' beyond' : ''}`,
      disabled: beyond,
      title: beyond ? `Beyond this drive's rating of warp ${maxWarp}` : `Warp ${f}`,
      'aria-label': `Warp factor ${f}`,
      'aria-pressed': on ? 'true' : 'false',
      onclick: beyond ? null : press(app, {
        action: 'warp_factor', warp: f, chairLabel: `warp ${f}`,
      }, 'ui_tap'),
    }, [
      el('span', { class: 'lever' }),
      el('span', { class: 'digit', text: String(f) }),
    ]);
  }));

  return el('div', { class: 'chair-warp' }, [
    el('div', { class: 'label', text: `Warp factor — standing at ${standing % 1 ? standing.toFixed(1) : standing}` }),
    switches,
  ]);
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
    button('On screen', press(app, { action: 'viewscreen', chairLabel: 'on screen' }, 'ui_tap'), {
      color: 'ice',
      sub: app.screen === 'viewscreen' ? 'Screen off' : 'The forward view from the bridge',
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
    warpSwitches(app),
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
