// Every screen in the game, rendered fresh from state on each frame that
// needs it. No virtual DOM, no diffing — the panels are small enough that a
// straight rebuild is cheaper than any machinery to avoid one.

import {
  el, clear, panel, button, readout, shieldDiagram, powerSlider,
  pill, modal, field, textInput, select, officerRow, logLine,
} from './lcars.js';
import { haptic } from './touch.js';
import { audio } from '../audio/engine.js';

import { MODES } from '../core/state.js';
import { SUBSYSTEMS, SUBSYSTEM_LABEL, PRESET_LIST } from '../sim/power.js';
import { SKILLS, BRANCHES, BRANCH_LABEL, RANKS } from '../sim/skills.js';
import { CONSOLES } from '../sim/loadout.js';
import { ABILITIES } from '../sim/officers.js';
import { availableHails } from '../sim/diplomacy.js';
import { STATIONS, ERA_LIST, SPECIES } from '../world/crews.data.js';
import { FACTIONS, standingTier } from '../world/factions.data.js';
import { distanceLy } from '../world/systems.data.js';
import { travelHours, fuelCost } from '../world/galaxy.js';
import { formatDuration } from '../core/time.js';
import { commandableAt } from '../world/ships.data.js';

// ---------------------------------------------------------------- helpers

function tap(fn, cue = 'ui_tap', feel = 'tap') {
  return (...args) => {
    audio.play(cue);
    haptic(feel);
    return fn(...args);
  };
}

// ================================================================ BRIDGE

export function bridgeScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });

  // --- Where we are ---
  const sys = g.location;
  const locPanel = panel('Position', [
    el('p', {}, [el('b', { text: sys.name }), ' — ', el('span', { class: 'muted', text: sys.description })]),
    el('div', { class: 'meta' }, [
      pill(sys.type),
      sys.contested ? pill('contested', 'red') : null,
      sys.hazard ? pill(sys.hazard.replace(/_/g, ' '), 'red') : null,
      ...(sys.facilities ?? []).map((f) => pill(f, 'green')),
    ]),
  ], 'accent');
  locPanel.classList.add('sys-card');
  root.append(locPanel);

  // --- Ship status ---
  root.append(panel('Ship Status', [
    shieldDiagram(g.ship),
    readout('Crew', g.ship.crewPct, `${g.ship.crew}`),
    readout('Antimatter', g.ship.antimatter / 100, `${g.ship.antimatter.toFixed(0)}%`),
    g.ship.maxTorpedoes > 0
      ? readout('Torpedoes', g.ship.torpedoes / g.ship.maxTorpedoes, `${g.ship.torpedoes}`)
      : null,
    g.ship.fires > 0 ? el('p', { class: 'muted', text: `${g.ship.fires} fire${g.ship.fires > 1 ? 's' : ''} burning on the hull.` }) : null,
    g.ship.coreEjected ? el('p', { class: 'muted', text: 'Warp core ejected. Impulse only until we dock.' }) : null,
  ], g.ship.hullPct < 0.4 ? 'danger' : g.ship.hullPct < 0.8 ? 'warn' : ''));

  // --- Missions here ---
  const missions = g.availableMissions();
  if (missions.length) {
    root.append(panel('Orders Available', missions.map((m) =>
      button(m.title, tap(() => { app.startMission(m.id); }), {
        color: 'amber', sub: m.summary,
      }))));
  }

  // --- Actions ---
  const actions = [];
  if (g.canDock()) {
    actions.push(button('Request docking', tap(() => {
      const r = g.dock();
      if (r.ok) { audio.play('dock'); haptic('confirm'); }
      app.render();
    }, 'ui_confirm'), { color: 'green', sub: 'Full repair, resupply, and crew replacement' }));
  }
  actions.push(button('Set course', tap(() => app.go('galaxy')), { color: 'blue', sub: 'Plot a course to another system' }));
  actions.push(button('Long-range scan', tap(() => {
    audio.play('scan');
    const enc = app.scanSystem();
    app.showMessage('Sensor Sweep', enc);
  }, 'scan'), { color: 'ice' }));

  if (g.ship.hullPct < 1 && !g.canDock()) {
    actions.push(button('Effect repairs', tap(() => {
      const before = g.ship.hullPct;
      g.ship.repair(g.ship.maxHull * 0.12);
      g.clock.advanceStardate(0.8);
      g.pushLog(`Repair teams restored hull integrity to ${Math.round(g.ship.hullPct * 100)}%.`, 'engineering');
      app.showMessage('Repairs', [
        `Hull integrity ${Math.round(before * 100)}% → ${Math.round(g.ship.hullPct * 100)}%.`,
        'Nineteen hours. The chief says that is the best she can do without a starbase.',
      ]);
    }), { color: 'peach', sub: 'Costs time. Cannot fully repair without a starbase.' }));
  }
  root.append(panel('Bridge', actions));

  // --- Recent log ---
  root.append(panel('Ship’s Log', g.log.slice(-6).reverse().map(logLine)));
  return root;
}

// ================================================================ TRANSIT

export function transitScreen(app) {
  const g = app.game;
  const t = g.transit;
  const root = el('div', { class: 'scroll' });
  if (!t) return root;

  root.append(panel('Under Way', [
    el('p', { html: `Course: <b>${t.from.name}</b> → <b>${t.to.name}</b>` }),
    el('p', { class: 'muted', text: `Warp ${t.warpFactor.toFixed(1)} · ${t.route.lightYears.toFixed(1)} light-years · ${formatDuration(t.totalHours)} at this speed${t.route.charted ? '' : ' · uncharted course'}` }),
    readout('Progress', t.progress, `${Math.round(t.progress * 100)}%`),
    readout('ETA', 1 - t.progress, formatDuration(Math.max(0, t.remainingHours))),
  ], 'accent'));

  root.append(panel('Ship Status', [
    shieldDiagram(g.ship),
    readout('Antimatter', g.ship.antimatter / 100, `${g.ship.antimatter.toFixed(0)}%`),
  ]));

  root.append(panel('Bridge', [
    button('Drop out of warp', tap(() => {
      const near = t.nearestSystem(g.galaxy);
      g.locationId = near.id;
      g.clock.advanceStardate(t.totalHours * t.progress / 24);
      g.transit = null;
      g.mode = MODES.BRIDGE;
      audio.play('warp_drop');
      g.pushLog(`Dropped to impulse at ${near.name}.`, 'helm');
      app.render();
    }, 'ui_back'), { color: 'ghost' }),
  ]));

  root.append(panel('Ship’s Log', g.log.slice(-5).reverse().map(logLine)));
  return root;
}

// ================================================================ TACTICAL

export function tacticalScreen(app) {
  const g = app.game;
  const eng = g.engagement;
  const root = el('div', { class: 'screen tactical-screen' });

  const wrap = el('div', { class: 'tactical-wrap' });
  const canvas = el('canvas', { id: 'tactical' });
  wrap.append(canvas);

  const overlay = el('div', { class: 'tactical-overlay' });
  wrap.append(overlay);
  root.append(wrap);
  app.tacticalCanvas = canvas;
  app.tacticalOverlay = overlay;

  const side = el('div', { class: 'tactical-side scroll' });
  root.append(side);

  if (!eng) {
    side.append(panel('Standing Down', [el('p', { text: 'No hostile contacts.' })]));
    return root;
  }

  // --- Target ---
  const target = eng.target;
  side.append(panel('Target', [
    target && !target.destroyed
      ? el('div', {}, [
        el('p', {}, [el('b', { text: target.name }), ' — ', target.cls.name]),
        readout('Hull', target.hullPct),
        readout('Shields', target.shieldPct),
        el('div', {}, [
          pill(FACTIONS[target.faction]?.short ?? target.faction),
          pill(`${Math.round(g.ship.distanceTo(target))} km`),
          target.cloaked ? pill('cloaked', 'red') : null,
          target.fleeing ? pill('withdrawing', 'amber') : null,
        ]),
      ])
      : el('p', { class: 'muted', text: 'No target locked.' }),
    eng.liveHostiles.length > 1
      ? button('Next target', tap(() => { eng.cycleTarget(); app.render(); }), { color: 'ice' })
      : null,
  ], 'danger'));

  // --- Subsystem targeting ---
  const subs = [
    ['weapons', 'Weapons'], ['shields', 'Shields'], ['engines', 'Engines'], ['warpcore', 'Warp core'],
  ];
  side.append(panel('Target Subsystem', [
    el('div', { class: 'grid-2' }, [
      ...subs.map(([key, label]) => button(label, tap(() => {
        eng.targetSubsystem(eng.targetedSubsystem === key ? null : key);
        app.render();
      }), { color: eng.targetedSubsystem === key ? 'red' : 'blue' })),
    ]),
    el('p', { class: 'hint', text: 'Targeting a subsystem trades raw damage for a specific kill: engines to stop a runner, weapons to survive a Galor.' }),
  ]));

  // --- Weapons ---
  side.append(panel('Weapons', [
    ...g.ship.weapons.map((w) => readout(
      w.name.replace(/^(Forward|Aft)\s+/, ''),
      w.cooldown > 0 ? 1 - w.cooldown / w.cycle : 1,
      w.cooldown > 0 ? `${w.cooldown.toFixed(1)}s` : 'ready',
    )),
    el('div', { class: 'btn-row' }, [
      button('Fire', tap(() => {
        const n = eng.fireAll();
        if (n) { audio.play('phaser', { throttle: 120 }); haptic('hit_light'); }
        else { audio.play('ui_deny'); }
      }, 'ui_tap'), { color: 'red' }),
      button(eng.autoFire ? 'Auto: on' : 'Auto: off', tap(() => {
        eng.autoFire = !eng.autoFire;
        app.render();
      }), { color: eng.autoFire ? 'green' : 'ghost' }),
    ]),
    g.ship.maxTorpedoes > 0
      ? readout('Torpedoes', g.ship.torpedoes / g.ship.maxTorpedoes, `${g.ship.torpedoes}`)
      : null,
  ]));

  // --- Helm ---
  side.append(panel('Helm', [
    el('div', { class: 'grid-2' }, [
      button('Come about', tap(() => eng.comeAboutTo(eng.target)), { color: 'blue' }),
      button(g.ship.evasive ? 'Evasive: on' : 'Evasive', tap(() => {
        eng.evasive(!g.ship.evasive); app.render();
      }), { color: g.ship.evasive ? 'green' : 'blue' }),
    ]),
    powerSlider('Throttle', g.ship.throttle * 100, (v) => { g.ship.throttle = v / 100; }),
    button('Disengage — go to warp', tap(() => {
      if (!eng.beginWarpOut()) audio.play('ui_deny');
      app.render();
    }), { color: 'peach', sub: 'Eight seconds at this heading. They get all eight.' }),
  ]));

  // --- Power ---
  side.append(powerPanel(app));

  // --- Career signature power ---
  side.append(signaturePanel(app));

  // --- Bridge officer abilities ---
  side.append(abilitiesPanel(app));

  // --- Damage control ---
  const dc = [];
  if (g.ship.breaching) {
    dc.push(button(`EJECT THE CORE — ${g.ship.breachTimer.toFixed(0)}s`, tap(() => {
      if (g.ship.ejectCore()) {
        audio.play('explosion');
        haptic('explosion');
        g.pushLog('Core ejected. We are on impulse power.', 'engineering');
      }
      app.render();
    }, 'ui_deny', 'explosion'), { color: 'red' }));
  }
  for (const id of g.loadout.equipped.device) {
    dc.push(button(CONSOLES[id]?.name ?? id, tap(() => {
      app.useDevice(id);
      app.render();
    }), { color: 'amber', sub: CONSOLES[id]?.description }));
  }
  if (dc.length) side.append(panel('Damage Control', dc, 'danger'));

  // --- Comms ---
  const factionId = eng.hostiles[0]?.faction;
  if (FACTIONS[factionId]?.hailable) {
    side.append(panel('Communications', [
      button('Hail them', tap(() => app.openHail(factionId)), { color: 'lilac' }),
    ]));
  }

  side.append(panel('Tactical Log', eng.log.slice(-8).reverse().map(logLine)));
  return root;
}


/** The captain's own once-per-engagement power. */
function signaturePanel(app) {
  const g = app.game;
  const c = g.character;
  if (!c) return el('div');
  const career = c.career;
  const used = c.signatureUsed;
  return panel('Captain', [
    button(career.signature, used ? null : tap(() => app.useSignature(), 'ui_confirm'), {
      color: used ? 'ghost' : 'peach',
      sub: used ? 'Already used this engagement.' : career.signatureText,
      disabled: used,
    }),
  ], used ? '' : 'warn');
}

function powerPanel(app) {
  const g = app.game;
  return panel('Power Distribution', [
    el('div', { class: 'grid-3' }, PRESET_LIST.slice(0, 3).map((p) =>
      button(p.label, tap(() => {
        g.ship.power.applyPreset(p.id);
        audio.play('power_reroute');
        app.render();
      }), { color: g.ship.power.preset === p.id ? 'green' : 'blue' }))),
    el('div', { class: 'grid-2' }, PRESET_LIST.slice(3).map((p) =>
      button(p.label, tap(() => {
        g.ship.power.applyPreset(p.id);
        audio.play('power_reroute');
        app.render();
      }), { color: g.ship.power.preset === p.id ? 'green' : 'blue' }))),
    ...SUBSYSTEMS.map((s) => powerSlider(SUBSYSTEM_LABEL[s], g.ship.power.target[s], (v) => {
      g.ship.power.set(s, v);
      audio.play('ui_tap', { throttle: 80 });
    })),
    el('p', { class: 'hint', text: `Total ${Math.round(g.ship.power.total)} of ${g.ship.power.cap}. Levels settle over a few seconds — the EPS grid is not instant.` }),
  ]);
}

function abilitiesPanel(app) {
  const g = app.game;
  const ready = g.crew.readyAbilities();
  const nodes = ready.slice(0, 8).map(({ officer, ability }) =>
    button(ability.name, tap(() => {
      app.useAbility(officer, ability);
      app.render();
    }, 'computer_ack'), { color: 'lilac', sub: `${officer.name} — ${ability.order}` }));

  const cooling = [];
  for (const o of g.crew.available) {
    for (const id of o.abilities) {
      const cd = o.cooldowns[id] ?? 0;
      if (cd > 0) cooling.push(`${ABILITIES[id]?.name ?? id} ${cd.toFixed(0)}s`);
    }
  }
  return panel('Bridge Officers', [
    ...nodes,
    cooling.length ? el('p', { class: 'hint', text: `Recharging: ${cooling.join(' · ')}` }) : null,
    !nodes.length && !cooling.length ? el('p', { class: 'muted', text: 'No officers available.' }) : null,
  ]);
}

// ================================================================ GALAXY

export function galaxyScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'screen' });

  const wrap = el('div', { class: 'map-wrap' });
  const canvas = el('canvas', { id: 'galaxy' });
  wrap.append(canvas);
  root.append(wrap);
  app.galaxyCanvas = canvas;

  const detail = el('div', { class: 'scroll', style: { flex: '0 0 auto', maxHeight: '52%' } });
  root.append(detail);
  app.galaxyDetail = detail;
  app.renderSystemDetail(g.galaxy.get(app.selectedSystemId ?? g.locationId));

  return root;
}

export function systemDetail(app, sys) {
  const g = app.game;
  if (!sys) return el('div');

  const here = sys.id === g.locationId;
  const ly = distanceLy(g.locationId, sys.id);
  const route = g.galaxy.plotCourse(g.locationId, sys.id);
  const visited = g.galaxy.visited.has(sys.id);

  const nodes = [
    el('p', {}, [
      el('b', { text: sys.name }),
      here ? ' — present position' : '',
    ]),
    el('div', { class: 'meta' }, [
      pill(sys.type),
      sys.faction && sys.faction !== 'none' ? pill(FACTIONS[sys.faction]?.short ?? sys.faction) : null,
      sys.contested ? pill('contested', 'red') : null,
      sys.hazard ? pill(sys.hazard.replace(/_/g, ' '), 'red') : null,
      !visited ? pill('unvisited', 'amber') : null,
      ...(sys.facilities ?? []).map((f) => pill(f, 'green')),
    ]),
    el('p', { class: 'muted', text: visited || !sys.unexplored ? sys.description : 'No survey on file.' }),
  ];

  if (!here) {
    nodes.push(el('p', { class: 'hint', text: `${ly.toFixed(1)} ly direct · ${route.lightYears.toFixed(1)} ly by ${route.charted ? 'charted lanes' : 'uncharted course'} · ${route.path.length - 1} leg${route.path.length > 2 ? 's' : ''}` }));

    // Warp factor picker with real time and fuel costs.
    const maxWarp = Math.floor(g.ship.cls.maxWarp);
    const factors = [4, 6, 8, maxWarp].filter((f, i, a) => f <= maxWarp && a.indexOf(f) === i);
    const eff = (g.ship.cls.warpEfficiency ?? 1) * g.progress.warpEfficiency;
    nodes.push(el('div', { class: `grid-${Math.min(4, factors.length)}` }, factors.map((f) => {
      const hours = travelHours(route.lightYears, f, eff);
      const fuel = fuelCost(route.lightYears, f, eff);
      const tooExpensive = fuel > g.ship.antimatter;
      return button(`Warp ${f}`, tap(() => {
        const r = g.setCourse(sys.id, f);
        if (r.ok) {
          audio.play('warp_engage');
          haptic('warp');
          audio.setAlertLevel('warp');
          app.go('bridge');
        } else {
          audio.play('ui_deny');
          app.showMessage('Helm', [r.error]);
        }
      }, 'ui_confirm'), {
        color: tooExpensive ? 'ghost' : 'orange',
        sub: `${formatDuration(hours)} · ${fuel.toFixed(1)}% AM`,
        disabled: tooExpensive,
      });
    })));
  }

  const missions = g.missions.availableAt(sys.id, g);
  if (missions.length) {
    nodes.push(el('p', { class: 'hint' }, [
      pill(`${missions.length} mission${missions.length > 1 ? 's' : ''} available`, 'amber'),
    ]));
  }

  const card = panel(null, nodes, 'accent');
  card.classList.add('sys-card');
  return card;
}

// ================================================================ CREW

export function crewScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });

  root.append(panel('Senior Staff', [
    ...STATIONS.map((s) => {
      const o = g.crew.officers.find((x) => x.station === s.id);
      if (!o) return null;
      return el('div', {}, [
        el('div', { class: 'speaker', text: s.label }),
        officerRow(o, () => app.showOfficer(o)),
      ]);
    }),
  ]));

  const lost = g.ledger.lostOfficers;
  if (lost.length) {
    root.append(panel('In Memoriam', lost.map((o) =>
      el('p', { class: 'muted', text: `${o.name} — ${o.station?.replace(/_/g, ' ') ?? 'crew'}${o.system ? `, at ${o.system}` : ''}` })), 'danger'));
  }

  root.append(panel('Complement', [
    readout('Crew', g.ship.crewPct, `${g.ship.crew} / ${g.ship.maxCrew}`),
    g.ship.injured > 0 ? el('p', { class: 'muted', text: `${g.ship.injured} in sickbay.` }) : null,
    el('p', { class: 'hint', text: `${g.ledger.count('lives_lost')} lost under your command to date.` }),
  ]));

  return root;
}

export function officerDetail(app, officer) {
  const nodes = [
    el('p', {}, [el('b', { text: `${officer.rank} ${officer.name}` })]),
    el('p', { class: 'muted', text: `${officer.species} · ${STATIONS.find((s) => s.id === officer.station)?.label ?? officer.station}` }),
    readout('Expertise', officer.expertise / 100, `${officer.expertise}`),
    readout('Discipline', officer.discipline / 100, `${officer.discipline}`),
    readout('Daring', officer.daring / 100, `${officer.daring}`),
    readout('Candour', officer.candor / 100, `${officer.candor}`),
    el('h3', { text: 'Abilities' }),
    ...officer.abilities.map((id) => {
      const a = ABILITIES[id];
      return a ? el('p', { class: 'hint', html: `<b>${a.name}</b> — “${a.order}”. ${a.cooldown}s cooldown.` }) : null;
    }),
  ];

  if (!officer.alive) {
    nodes.push(el('p', { class: 'muted', text: `Deceased — ${officer.cause ?? 'killed in the line of duty'}.` }));
  } else if (officer.injured) {
    nodes.push(el('p', { class: 'muted', text: 'Currently in sickbay and unavailable for duty.' }));
  }

  // Officers you can teach something new.
  const g = app.game;
  const learnable = Object.values(ABILITIES).filter((a) =>
    a.dept === officer.dept && !officer.abilities.includes(a.id) && a.rank <= g.progress.rank.tier);
  if (learnable.length && officer.alive) {
    nodes.push(el('h3', { text: 'Training' }));
    for (const a of learnable.slice(0, 4)) {
      nodes.push(button(`Train: ${a.name}`, tap(() => {
        officer.learn(a.id);
        g.clock.advanceStardate(1);
        g.pushLog(`${officer.name} completed training in ${a.name}.`, 'captain');
        app.closeModal();
        app.render();
      }, 'ui_confirm'), { color: 'blue', sub: `“${a.order}” · one day` }));
    }
  }
  return nodes;
}

// ================================================================ CAPTAIN

export function captainScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });
  const p = g.progress;

  root.append(panel('Service Record', [
    el('p', {}, [el('b', { text: `${p.rankName} ${g.captain.name}` })]),
    el('p', { class: 'muted', text: `${g.captain.species} · ${g.captain.serialNumber}` }),
    readout('Rank progress', p.rankProgress,
      p.nextRank ? `${p.xp} / ${p.nextRank.xp}` : 'max'),
    el('p', { class: 'hint', text: p.nextRank ? `Next: ${p.nextRank.name}` : 'Highest rank attained.' }),
    el('div', {}, [
      pill(`Assessment: ${g.ledger.assessment().label}`,
        g.ledger.serviceScore() >= 20 ? 'green' : g.ledger.serviceScore() < -20 ? 'red' : ''),
      pill(`Score ${g.ledger.serviceScore()}`),
    ]),
    g.ledger.inquiryOpen
      ? el('p', { class: 'muted', text: 'A board of inquiry is open. Promotion is suspended until it concludes.' })
      : null,
  ], g.ledger.inquiryOpen ? 'danger' : 'accent'));

  // --- Skills ---
  root.append(panel(`Skills — ${p.unspent} point${p.unspent === 1 ? '' : 's'} unspent`, [
    ...BRANCHES.flatMap((branch) => [
      el('h3', { text: BRANCH_LABEL[branch] }),
      ...Object.values(SKILLS).filter((s) => s.branch === branch).map((skill) => {
        const ranks = p.ranksIn(skill.id);
        return el('div', { class: 'skill' }, [
          el('div', { class: 'info' }, [
            el('b', { text: skill.name }),
            el('small', { text: skill.description }),
          ]),
          el('div', { class: 'pips' }, Array.from({ length: skill.max }, (_, i) =>
            el('i', { class: i < ranks ? 'on' : '' }))),
          el('button', {
            disabled: !p.canSpend(skill.id),
            onclick: p.canSpend(skill.id) ? tap(() => {
              p.spend(skill.id);
              g.applyAllMods();
              app.render();
            }, 'ui_confirm') : null,
            text: '+',
          }),
        ]);
      }),
    ]),
  ]));

  // --- Reputation ---
  root.append(panel('Standing', Object.values(FACTIONS)
    .filter((f) => f.id !== 'federation')
    .map((f) => {
      const v = g.ledger.standingOf(f.id);
      const tier = standingTier(v);
      return readout(f.short, (v + 100) / 200, tier.label);
    })));

  // --- Ledger ---
  const recent = g.ledger.recent(10);
  root.append(panel('Command Record', recent.length
    ? recent.map((e) => el('p', { class: 'hint', text: `SD ${e.stardate ?? '—'} · ${e.text}` }))
    : [el('p', { class: 'muted', text: 'Nothing of note yet.' })]));

  return root;
}

// ================================================================ SHIP / LOADOUT

export function shipScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });

  root.append(panel(`${g.ship.name} — ${g.ship.registry}`, [
    el('p', { class: 'muted', text: g.ship.cls.description }),
    el('div', {}, [
      pill(g.ship.cls.name), pill(g.ship.cls.role),
      pill(`warp ${g.ship.cls.maxWarp}`), pill(`crew ${g.ship.maxCrew}`),
    ]),
    shieldDiagram(g.ship),
    readout('Structural integrity', g.ship.subsystems.warpcore, `${Math.round(g.ship.subsystems.warpcore * 100)}%`),
  ], 'accent'));

  root.append(panel('Subsystems', Object.entries(g.ship.subsystems).map(([k, v]) =>
    readout(k.replace(/([a-z])([A-Z])/g, '$1 $2'), v))));

  // --- Consoles ---
  for (const slot of ['tactical', 'engineering', 'science', 'device']) {
    const cap = g.loadout.capacity(slot);
    if (!cap) continue;
    const equipped = g.loadout.equipped[slot];
    root.append(panel(`${slot} — ${equipped.length}/${cap}`, [
      ...equipped.map((id) => button(CONSOLES[id]?.name ?? id, tap(() => {
        g.loadout.unequip(id);
        g.applyAllMods();
        app.render();
      }, 'ui_back'), { color: 'blue', sub: `${CONSOLES[id]?.description ?? ''} — tap to remove` })),
      ...g.loadout.inventory
        .filter((id) => CONSOLES[id]?.slot === slot)
        .filter((id, i, a) => a.indexOf(id) === i)
        .map((id) => {
          const count = g.loadout.inventory.filter((x) => x === id).length;
          return button(`Install ${CONSOLES[id]?.name ?? id}${count > 1 ? ` ×${count}` : ''}`, tap(() => {
            g.loadout.equip(id);
            g.applyAllMods();
            app.render();
          }, 'ui_confirm'), {
            color: 'ghost',
            sub: CONSOLES[id]?.description,
            disabled: g.loadout.free(slot) <= 0,
          });
        }),
    ]));
  }

  // --- Refit ---
  if (g.location?.facilities?.includes('shipyard')) {
    const options = commandableAt(g.progress.shipTier).filter((c) => c.id !== g.ship.classId);
    if (options.length) {
      root.append(panel('Shipyard', [
        el('p', { class: 'hint', text: 'A change of command means a change of ship. Your consoles come with you; anything that no longer fits goes into storage.' }),
        ...options.map((c) => button(c.name, tap(() => app.changeShip(c.id), 'ui_confirm'), {
          color: 'amber',
          sub: `${c.role} · hull ${c.hull} · warp ${c.maxWarp} · tier ${c.tier}`,
        })),
      ]));
    }
  }

  return root;
}

// ================================================================ LOG

export function logScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });
  root.append(panel('Ship’s Log', g.log.slice().reverse().map(logLine)));
  return root;
}

// ================================================================ OPTIONS

export function optionsScreen(app) {
  const s = app.settings;
  const root = el('div', { class: 'scroll' });

  const vol = (label, key) => {
    const val = el('div', { class: 'val', text: `${Math.round(s[key] * 100)}` });
    const input = el('input', {
      type: 'range', min: '0', max: '100', value: String(Math.round(s[key] * 100)),
      oninput: (e) => {
        s[key] = parseInt(e.target.value, 10) / 100;
        val.textContent = e.target.value;
        audio.setVolume(key === 'master' ? 'master' : key, s[key]);
        app.saveSettings();
      },
    });
    return el('div', { class: 'power-row' }, [el('div', { class: 'label', text: label }), input, val]);
  };

  root.append(panel('Audio', [
    vol('Master', 'master'), vol('Effects', 'sfx'), vol('Interface', 'ui'),
    vol('Alerts', 'alert'), vol('Ambience', 'ambience'),
    button(s.voice ? 'Computer voice: on' : 'Computer voice: off', tap(() => {
      s.voice = !s.voice;
      audio.voiceEnabled = s.voice;
      app.saveSettings();
      app.render();
    }), { color: s.voice ? 'green' : 'ghost', sub: 'Officer acknowledgements spoken by the device' }),
  ]));

  root.append(panel('Interface', [
    button(s.haptics ? 'Haptics: on' : 'Haptics: off', tap(() => {
      s.haptics = !s.haptics; app.applySettings(); app.render();
    }), { color: s.haptics ? 'green' : 'ghost' }),
    button(s.wakeLock ? 'Keep screen awake: on' : 'Keep screen awake: off', tap(() => {
      s.wakeLock = !s.wakeLock; app.applySettings(); app.render();
    }), { color: s.wakeLock ? 'green' : 'ghost' }),
    button(s.reduceMotion ? 'Reduce motion: on' : 'Reduce motion: off', tap(() => {
      s.reduceMotion = !s.reduceMotion; app.applySettings(); app.render();
    }), { color: s.reduceMotion ? 'green' : 'ghost' }),
    field('Text size', select([
      { value: 'normal', label: 'Normal' },
      { value: 'large', label: 'Large' },
      { value: 'xlarge', label: 'Extra large' },
    ], s.textSize, (v) => { s.textSize = v; app.applySettings(); })),
  ]));

  root.append(panel('Command Record', [
    button('Save', tap(() => { app.save(); app.showMessage('Saved', ['Command record stored.']); }, 'ui_confirm'), { color: 'green' }),
    button('Export to file', tap(() => app.exportSave()), { color: 'blue', sub: 'Download the record as JSON' }),
    button('Import from file', tap(() => app.importSave()), { color: 'blue' }),
    button('Abandon command', tap(() => app.confirmNewGame(), 'ui_deny'), { color: 'red', sub: 'Start over with a new captain' }),
  ]));

  root.append(panel('About', [
    el('p', { class: 'hint', text: 'A Star Trek Starfleet command simulator. Runs entirely offline — no network, no accounts, no telemetry. Every sound is generated by the device at the moment you hear it; no audio files are used.' }),
    el('p', { class: 'hint', text: 'Fan work, made for the love of the thing. Star Trek is the property of its rights holders and this project is not affiliated with them.' }),
    el('p', { class: 'hint', text: `World seed ${app.game.seed.toString(16)} — the same seed always builds the same galaxy.` }),
  ]));

  return root;
}

// ================================================================ ENCOUNTER

export function encounterScreen(app) {
  const g = app.game;
  const enc = g.encounter;
  const root = el('div', { class: 'scroll' });
  if (!enc) return root;

  root.append(panel(enc.title, [
    el('div', { class: 'speaker', text: enc.hostile ? 'Tactical' : 'Science' }),
    el('p', { text: enc.text }),
    ...(enc.ships ?? []).map((s) => el('p', { class: 'hint', text: `${s.name} — ${s.cls.name}` })),
  ], enc.hostile ? 'danger' : 'warn'));

  const choices = [];
  const add = (id, label, sub, color) => choices.push(
    button(label, tap(() => app.resolveEncounter(id), 'ui_select'), { color, sub }));

  if (enc.hostile) {
    add('engage', 'Engage', 'Red alert. Bring weapons to bear.', 'red');
    if (enc.hailable !== false && FACTIONS[enc.factionId]?.hailable) {
      add('hail', 'Hail them', 'Talking is free until it is not.', 'lilac');
    }
    add('withdraw', 'Withdraw', 'Leave the system.', 'ghost');
  } else {
    switch (enc.kind) {
      case 'distress':
        add('assist', 'Render assistance', `${enc.lives ?? 'Unknown'} lives at stake. Costs time.`, 'green');
        add('ignore', 'Continue on course', 'It will be in the log either way.', 'ghost');
        break;
      case 'derelict':
        add('board', 'Send an away team', 'Salvage is possible. So is the other thing.', 'amber');
        add('scan', 'Scan from here', 'Safer. Less useful.', 'ice');
        add('withdraw', 'Leave it', null, 'ghost');
        break;
      case 'anomaly':
        add('approach', 'Take us in close', `Hazard rating ${Math.round((enc.anomaly?.hazard ?? 0.3) * 100)}%.`, 'amber');
        add('scan', 'Scan from a safe distance', null, 'ice');
        add('withdraw', 'Note it and move on', null, 'ghost');
        break;
      case 'convoy':
        add('escort', 'Provide escort', `${enc.escortReward ?? 300} credits. Costs time.`, 'green');
        add('withdraw', 'Decline', null, 'ghost');
        break;
      case 'first_contact':
        if (enc.preWarp) {
          root.append(panel('General Order One', [
            el('p', { class: 'muted', text: 'Sensors confirm the culture is pre-warp. The Prime Directive applies, and Starfleet will read this page of the log very carefully.' }),
          ], 'danger'));
          add('withdraw', 'Withdraw without revealing ourselves', 'The Directive exists for a reason.', 'green');
          add('contact_prewarp', 'Make contact anyway', 'This cannot be undone.', 'red');
        } else {
          add('contact_peaceful', 'Open a channel', 'First contact protocol.', 'green');
          add('scan', 'Scan them first', null, 'ice');
          add('withdraw', 'Withdraw', null, 'ghost');
        }
        break;
      case 'patrol':
        if (enc.hailable) add('hail', 'Hail them', null, 'lilac');
        add('withdraw', 'Continue', null, 'ghost');
        break;
      default:
        add('withdraw', 'Continue', null, 'ghost');
        break;
    }
  }

  root.append(panel('Orders', choices));
  return root;
}

// ================================================================ MISSION

export function missionScreen(app) {
  const g = app.game;
  const m = g.missions.active;
  const root = el('div', { class: 'scroll' });
  if (!m) return root;

  const stage = m.stage;
  root.append(panel(m.title, [
    stage.speaker ? el('div', { class: 'speaker', text: stage.speaker }) : null,
    el('p', { text: stage.text }),
  ], 'accent'));

  root.append(panel('Orders', m.choices().map((c) =>
    button(c.label, tap(() => app.chooseMission(c.id), 'ui_select'), {
      color: c.locked ? 'ghost' : 'orange',
      sub: c.lockReason ?? c.description,
      locked: c.locked,
    }))));

  return root;
}

// ================================================================ HAIL

export function hailOptions(app, factionId, onPick) {
  const g = app.game;
  const eng = g.engagement;
  const winning = eng
    ? g.ship.hullPct > (eng.liveHostiles.reduce((n, s) => n + s.hullPct, 0) / Math.max(1, eng.liveHostiles.length))
    : false;
  const options = availableHails(factionId, { winning });
  const faction = FACTIONS[factionId];

  return [
    el('p', { class: 'muted', text: faction?.description ?? '' }),
    el('p', { class: 'hint', text: `Current standing: ${standingTier(g.ledger.standingOf(factionId)).label}` }),
    ...options.map((o) => button(o.label, tap(() => onPick(o.id), 'ui_select'), {
      color: 'lilac', sub: o.description,
    })),
  ];
}

// ================================================================ NEW GAME

export function newGameScreen(app, onStart) {
  const draft = {
    firstName: 'Alexander', name: 'Reyes', species: 'Human',
    pronouns: 'they/them', background: 'command',
    crewMode: 'canon', era: 'tos', shipName: 'Enterprise',
    registry: 'NCC-1701', seed: '',
  };

  const root = el('div', { class: 'scroll' });

  root.append(panel('Starfleet Personnel File', [
    field('Given name', textInput(draft.firstName, (v) => { draft.firstName = v; })),
    field('Surname', textInput(draft.name, (v) => { draft.name = v; })),
    field('Species', select(SPECIES.map((s) => ({ value: s.name, label: s.name })), draft.species,
      (v) => { draft.species = v; })),
    field('Pronouns', select([
      { value: 'they/them', label: 'they / them' },
      { value: 'she/her', label: 'she / her' },
      { value: 'he/him', label: 'he / him' },
    ], draft.pronouns, (v) => { draft.pronouns = v; })),
    field('Background', select([
      { value: 'command', label: 'Command track — a point in Leadership' },
      { value: 'tactical', label: 'Tactical — a point in Beam Weapons' },
      { value: 'engineering', label: 'Engineering — a point in Damage Control' },
      { value: 'science', label: 'Science — a point in Sensor Analysis' },
      { value: 'diplomatic', label: 'Diplomatic corps — a point in Diplomacy' },
    ], draft.background, (v) => { draft.background = v; })),
  ], 'accent'));

  const crewPanelBody = el('div');
  const renderCrewPanel = () => {
    clear(crewPanelBody);
    crewPanelBody.append(
      el('div', { class: 'grid-2' }, [
        button('Canonical crew', tap(() => { draft.crewMode = 'canon'; renderCrewPanel(); }),
          { color: draft.crewMode === 'canon' ? 'green' : 'blue' }),
        button('Original crew', tap(() => { draft.crewMode = 'original'; renderCrewPanel(); }),
          { color: draft.crewMode === 'original' ? 'green' : 'blue' }),
      ]),
    );
    if (draft.crewMode === 'canon') {
      crewPanelBody.append(
        el('p', { class: 'hint', text: 'Serve with the senior staff of a chosen era.' }),
        ...ERA_LIST.map((e) => button(e.name, tap(() => { draft.era = e.id; renderCrewPanel(); }), {
          color: draft.era === e.id ? 'amber' : 'ghost',
          sub: `${e.description} · ${e.crew.map((c) => c.name).filter((n, i, a) => a.indexOf(n) === i).slice(0, 4).join(', ')}…`,
        })),
      );
    } else {
      crewPanelBody.append(el('p', { class: 'hint', text: 'A senior staff will be generated for you — species, traits, and abilities rolled from the world seed. They are yours, and they can be lost.' }));
    }
  };
  renderCrewPanel();
  root.append(panel('Crew', [crewPanelBody]));

  root.append(panel('Ship', [
    field('Ship name', textInput(draft.shipName, (v) => { draft.shipName = v; })),
    field('Registry', textInput(draft.registry, (v) => { draft.registry = v; })),
    el('p', { class: 'hint', text: 'Your first command is a heavy cruiser. Later ranks unlock heavier hulls at any shipyard.' }),
  ]));

  root.append(panel('Galaxy', [
    field('World seed (optional)', textInput('', (v) => { draft.seed = v; }, 'leave blank for a new galaxy')),
    el('p', { class: 'hint', text: 'The same seed always produces the same galaxy, the same encounters, and the same rolls. Share one to give someone your exact game.' }),
  ]));

  root.append(panel(null, [
    button('Assume command', tap(() => onStart(draft), 'ui_confirm'), { color: 'green' }),
  ]));

  return root;
}

// ================================================================ GAME OVER

export function gameOverScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });
  const assessment = g.ledger.assessment();

  root.append(panel('End of Commission', [
    el('p', { text: g.overReason ?? 'Your command has ended.' }),
    el('p', { class: 'big-stat center', text: assessment.label }),
    el('p', { class: 'hint center', text: `Service score ${g.ledger.serviceScore()}` }),
  ], 'danger'));

  root.append(panel('Final Record', [
    el('p', { class: 'hint', text: `Stardate ${g.stardate}. ${g.ledger.entries.length} entries.` }),
    readout('Lives saved', Math.min(1, g.ledger.count('lives_saved') / 20000), String(g.ledger.count('lives_saved'))),
    readout('Lives lost', Math.min(1, g.ledger.count('lives_lost') / 5000), String(g.ledger.count('lives_lost'))),
    el('p', {}, [
      pill(`${g.ledger.destroyedShips.length} ships destroyed`),
      pill(`${g.ledger.count('first_contact')} first contacts`, 'green'),
      pill(`${g.ledger.count('treaty_signed')} treaties`, 'green'),
      pill(`${g.ledger.count('prime_directive_violation')} Directive violations`, 'red'),
      pill(`${g.ledger.lostOfficers.length} officers lost`, 'red'),
    ]),
  ]));

  if (g.ledger.lostOfficers.length) {
    root.append(panel('The Dead', g.ledger.lostOfficers.map((o) =>
      el('p', { class: 'hint', text: `${o.name}${o.mission ? ` — ${o.mission}` : ''}` })), 'danger'));
  }

  root.append(panel(null, [
    button('New command', tap(() => app.confirmNewGame(true), 'ui_confirm'), { color: 'green' }),
  ]));

  return root;
}

export { modal, field, textInput, select };
