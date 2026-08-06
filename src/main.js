// Boot, the frame loop, and the shell that owns every screen.
//
// There is no loading step. The galaxy is generated from its seed, the audio
// graph is built on the first tap, and the first frame is the game.

import { el, clear, button, modal } from './ui/lcars.js';
import { haptic, configureTouch, requestWakeLock, releaseWakeLock, trackViewportInsets } from './ui/touch.js';
import { audio } from './audio/engine.js';
import { TacticalView } from './ui/tactical.js';
import { TacticalView3D } from './ui/tactical3d.js';
import { Renderer } from './gfx/gl.js';
import { FirstPersonView } from './ui/firstperson.js';
import { GalaxyMap } from './ui/galaxymap.js';
import * as screens from './ui/screens.js';
import { warpSwitches } from './ui/chair.js';
import { CharacterCreator, characterSheetScreen, reputationScreen } from './ui/charscreens.js';

import { Game, MODES } from './core/state.js';
import { on } from './core/events.js';
import { SIM_STEP } from './core/time.js';
import { hashSeed } from './core/rng.js';
import {
  saveGame, loadSave, hasSave, loadSettings, saveSettings as persistSettings,
  exportSave, downloadSave, importSave,
} from './core/save.js';

import { ABILITIES } from './sim/officers.js';
import { Ship, FACINGS } from './sim/ship.js';
import { parseOrder } from './ui/orders.js';
import { SKILLS } from './sim/skills.js';
import { RNG } from './core/rng.js';
import { FEAT_BY_ID, ABILITIES as ABILITY_LIST } from './rules/character.js';
import { CONSOLES } from './sim/loadout.js';

// TABS ARE FOR TEXT.
//
// The viewer, the tactical plot and the galaxy map used to be tabs, and they
// are not text — they are things you LOOK at, and a starship's crew looks at
// them on the main viewer or at a console. So the bridge is the first-person
// view now, what is outside is on the viewscreen inside it, and the map is the
// navigation console you walk to.
//
// What is left here is the record: the log, the roster, the manual. Reading is
// the one thing a tab is actually for.
const NAV = [
  { id: 'bridge', label: 'Bridge', ico: '⌂' },
  { id: 'log', label: 'Log', ico: '▤' },
  { id: 'ship', label: 'Ship', ico: '⬡' },
  { id: 'crew', label: 'Crew', ico: '☰' },
  { id: 'sheet', label: 'Captain', ico: '✧' },
  { id: 'reputation', label: 'Rep', ico: '◈' },
  { id: 'captain', label: 'Record', ico: '★' },
];

/** Which console panel a station opens when you walk up and use it. */
const STATION_PANEL = {
  helm: 'helm', navigation: 'galaxy', comms: 'comms', power: 'power',
  weapons: 'tactical', science: 'science', damage: 'ship', medical: 'crew',
  transport: 'transport', fabrication: 'shop', missions: 'missions',
  // Not a console anywhere on the ship — the panel a thing on a planet opens.
  survey: 'survey',
  log: 'log', record: 'captain', turbolift: 'turbolift', crew: 'crew',
  galaxy: 'galaxy',
};

const BACKGROUND_SKILL = {
  command: 'leadership', tactical: 'beam_weapons',
  engineering: 'damage_control', science: 'sensors', diplomatic: 'diplomacy',
};


/**
 * Render an outcome as an auditable card: the verdict, the arithmetic that
 * produced it, and the prose.
 *
 * Gameplay no longer rolls a d20, so this shows a margin — how comfortably or
 * how badly — rather than a die face. Everything else is unchanged: the terms
 * are still itemised, and the player can still see exactly which ability, which
 * officer and which circumstance contributed what.
 */
function rollCard(r) {
  const cls = r.criticalSuccess ? 'crit' : r.criticalFailure ? 'fumble' : '';
  const breakdown = (r.parts ?? [])
    .filter((p) => p.value !== 0)
    .map((p) => `${p.source} ${p.value >= 0 ? '+' : ''}${p.value}`)
    .join('  ·  ');

  // The margin bar: centred on the pass mark, filling right for a comfortable
  // success and left for a bad failure. It reads at a glance in a way a number
  // does not, which matters when the same modal is telling you an officer died.
  const margin = typeof r.margin === 'number' ? r.margin : null;
  const bar = margin === null ? null : el('div', { class: 'marginbar' }, [
    el('i', {
      class: margin >= 0 ? 'good' : 'bad',
      style: {
        width: `${Math.min(50, Math.abs(margin) * 3.2)}%`,
        [margin >= 0 ? 'left' : 'right']: '50%',
      },
    }),
  ]);

  return el('div', { class: `rollcard ${cls}`.trim() }, [
    el('div', { class: 'dieline', text: r.formatted ?? '' }),
    bar,
    breakdown ? el('div', { class: 'breakdown', text: breakdown }) : null,
    r.text ? el('div', { class: 'breakdown', text: r.text }) : null,
  ]);
}

class App {
  constructor(root) {
    this.root = root;
    this.settings = loadSettings();
    this.game = null;
    this.screen = 'bridge';
    this.selectedSystemId = null;
    this.modalHandle = null;
    this.tactical = null;
    this.map = null;
    this.needsRender = true;
    this.lastAutosave = 0;

    this.buildShell();
    this.applySettings();
    this.wireEvents();
    trackViewportInsets();
  }

  // ------------------------------------------------------------ shell

  buildShell() {
    clear(this.root);

    this.shipNameEl = el('span', { class: 'shipname', text: 'Starfleet' });
    this.stardateEl = el('span', { class: 'stardate', text: '' });
    this.root.append(el('div', { class: 'topbar' }, [
      el('div', { class: 'cap' }),
      el('div', { class: 'title' }, [this.shipNameEl, this.stardateEl]),
    ]));

    this.root.append(el('div', { class: 'alertbar' }));

    this.screenEl = el('div', { class: 'screen' });
    this.root.append(this.screenEl);

    // Order line — typed orders, parsed by ui/orders.js.
    this.orderInput = el('input', {
      type: 'text', placeholder: 'Give an order…',
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      onkeydown: (e) => { if (e.key === 'Enter') this.submitOrder(); },
    });
    this.orderBar = el('div', { class: 'orderbar' }, [
      // The parser accepts hundreds of phrasings and the game had no way to
      // say so. This is that way: one tap from wherever you are stuck.
      //
      // It sits to the LEFT of the input on purpose. Putting it between the
      // input and Order left it under the thumb that reaches for Order — and
      // made `.orderbar button` ambiguous, which the browser harness noticed
      // by typing an order and watching the manual open instead.
      el('button', {
        class: 'manual', text: '?', title: 'What can I say?', 'aria-label': 'Command reference',
        onclick: () => { audio.play('ui_tap'); haptic('tap'); this.go('reference'); },
      }),
      this.orderInput,
      el('button', { class: 'send', text: 'Order', onclick: () => this.submitOrder() }),
    ]);
    this.root.append(this.orderBar);

    this.navEl = el('div', { class: 'nav' });
    this.root.append(this.navEl);
    this.buildNav();
  }

  buildNav() {
    clear(this.navEl);
    // A contact waiting on the bridge is flagged, so stepping away to check
    // the map never loses track of the thing that needs an answer.
    const pending = this.game?.mode === MODES.ENCOUNTER;
    for (const item of NAV) {
      this.navEl.append(el('button', {
        class: this.screen === item.id ? 'active' : '',
        onclick: () => { audio.play('ui_select'); haptic('select'); this.go(item.id); },
      }, [
        el('div', { class: 'ico', text: item.ico }),
        el('div', { text: item.label }),
        item.id === 'bridge' && pending && this.screen !== 'bridge'
          ? el('div', { class: 'badge', text: '!' })
          : null,
      ]));
    }
    this.navEl.append(el('button', {
      class: this.screen === 'options' ? 'active' : '',
      onclick: () => { audio.play('ui_select'); haptic('select'); this.go('options'); },
    }, [el('div', { class: 'ico', text: '⚙' }), el('div', { text: 'Setup' })]));
  }

  applySettings() {
    const s = this.settings;
    // The interface has an era, and the game already knows which one. This is
    // the seam the stylesheet reads: TOS gets 1966 consoles, TNG/DS9/VOY get
    // LCARS, which is what those eras actually had.
    document.documentElement.dataset.era = this.game?.era ?? s.era ?? 'tos';
    document.documentElement.dataset.text = s.textSize ?? 'normal';
    document.documentElement.dataset.motion = s.reduceMotion ? 'reduced' : 'normal';
    // Reduced motion stops the deck moving and leaves the flash doing the work:
    // the hit is still visible, it just does not throw the camera about.
    if (this.fpv) this.fpv.shake = !s.reduceMotion;
    configureTouch({ haptics: s.haptics, wakeLock: s.wakeLock });
    audio.voiceEnabled = s.voice;
    for (const key of ['master', 'sfx', 'ui', 'alert', 'ambience']) {
      audio.setVolume(key, s[key] ?? 1);
    }
    // After the volumes, so muting wins over whatever they just restored.
    audio.setEnabled(!s.muted);
    if (s.wakeLock) requestWakeLock(); else releaseWakeLock();
    this.saveSettings();
  }

  saveSettings() { persistSettings(this.settings); }

  // ------------------------------------------------------------ events

  wireEvents() {
    // Somebody reported. Turn them round to say it — the event has carried the
    // station since the day it was written and nothing had ever listened.
    on('officer:speak', ({ station }) => { this.fpv?.speak(station); });

    on('alert', (level) => {
      document.documentElement.dataset.alert = level;
      audio.setAlertLevel(level === 'red' ? 'red' : level === 'yellow' ? 'yellow' : 'normal');
      if (level === 'red') { audio.play('red_alert'); haptic('alert'); }
      else if (level === 'yellow') audio.play('yellow_alert');
      else audio.play('alert_clear');
      this.needsRender = true;
    });

    on('combat:begin', () => { this.go('tactical'); });
    on('combat:end', ({ outcome }) => {
      this.game.finishCombat(outcome);
      this.showCombatResult(outcome);
    });

    on('combat:fire', ({ attacker, weapon, type }) => {
      if (type === 'torpedo') audio.play('torpedo_launch', { throttle: 120 });
      else if (attacker.faction === 'federation') {
        // A capital ship's main battery is not a light phaser bank.
        audio.play(weapon?.damage >= 250 ? 'phaser_heavy' : 'phaser', { throttle: 110 });
      }
      else audio.play('disruptor', { throttle: 110 });
    });

    on('combat:torpedo-impact', () => audio.play('torpedo_impact', { throttle: 90 }));

    // The countdown to losing the ship. There is one way out — eject the core —
    // and the warning tone existed in sfx.js and was played from nowhere.
    on('ship:breach', ({ ship, seconds }) => {
      if (!ship.isPlayer) return;
      audio.play('core_breach_warning');
      haptic('alert');
      this.game?.pushLog(
        `Warp core breach in ${Math.round(seconds)} seconds. Eject the core or we lose her.`,
        'engineering',
      );
      this.needsRender = true;
    });

    on('combat:player-hit', ({ severity, penetrated }) => {
      // Seen as well as heard. The viewer is the whole interface now, so
      // something arriving on the hull cannot be a sound effect alone.
      this.fpv?.hit(severity, penetrated);
      if (penetrated) {
        audio.play('hull_impact', { severity, throttle: 110 });
        haptic(severity > 0.5 ? 'hit_heavy' : 'hit_light');
        if (severity > 0.7) audio.play('console_explode', { throttle: 900 });
        // Structural stress, once the hull is genuinely in trouble. Sparingly
        // throttled — it is a groan, not a soundtrack.
        if (this.game && this.game.ship.hullPct < 0.4) {
          audio.play('hull_groan', { throttle: 4000 });
        }
      } else {
        audio.play('shield_impact', { severity, throttle: 110 });
        haptic('hit_light');
      }
    });

    on('combat:destroyed', ({ ship }) => {
      audio.play('explosion');
      if (ship === this.game?.ship) haptic('explosion');
    });

    on('officer:killed', ({ officer }) => {
      this.game?.pushLog(`${officer.rank} ${officer.name} was killed.`, 'medical');
      haptic('deny');
    });

    on('captain:promoted', (promo) => {
      audio.play('promotion');
      audio.play('boatswain');
      haptic('confirm');
      const g = this.game;
      if (g) {
        g.character.levelUp();
        g.pendingFeats = (g.pendingFeats ?? 0) + 1;
        g.applyAllMods();
      }
      this.showMessage('Promotion', [
        `You are promoted to ${promo.rank.name}.`,
        `${promo.points} skill points awarded, and a feat to choose on the Captain screen.`,
        `Character level ${g?.character.level ?? 1}. Proficiency is now ${g ? `+${g.character.proficiencyBonus}` : ''}.`,
      ]);
    });

    // Reputation tier-ups are a real unlock, so they are announced.
    on('reputation:tier', (up) => {
      audio.play('promotion');
      haptic('confirm');
      this.showMessage('Reputation', [
        `Your standing with them has advanced to ${up.name}.`,
        'New projects are available on the Reputation screen.',
      ]);
    });

    // Every d20 roll is captured so the player can audit the arithmetic.
    on('away:check', (result) => {
      this.recentRolls ??= [];
      this.recentRolls.push(result);
      if (this.recentRolls.length > 60) this.recentRolls.shift();
      if (result.criticalSuccess) { audio.play('ui_confirm'); haptic('confirm'); }
      else if (result.criticalFailure) { audio.play('ui_deny'); haptic('deny'); }
      else audio.play('ui_tap');
    });

    on('ledger:inquiry', () => {
      this.game?.ledger.setFlag('inquiry_summoned');
      this.showMessage('Signal from Starfleet Command', [
        'You are ordered to Starbase 11 to appear before a board of inquiry.',
        'Promotion is suspended until the board reports.',
      ]);
    });

    on('transit:begin', () => { this.go('bridge'); });
    on('arrived', () => { audio.play('warp_drop'); audio.setAlertLevel('normal'); this.needsRender = true; });
    // A hail brings you to the CHAIR, not to a separate screen. The encounter's
    // panel appears in the bridge's own strip, and the Bridge tab carries a
    // badge if you happen to be reading the roster when it comes in.
    on('encounter:begin', () => { this.go('bridge'); haptic('select'); });
    // To the BRIDGE, not to a mission screen. The stage is a panel there now,
    // the same way a hail and a transit are — an episode is something that
    // happens around you rather than a place you are sent.
    on('mission:start', () => { this.go('bridge'); });
    on('mission:stage', () => { this.needsRender = true; });
    on('game:over', () => { this.go('gameover'); });
    on('log', () => { this.needsRender = true; });

    // Unlock audio on any touch — mobile policy requires a gesture to start,
    // and the listener deliberately does NOT remove itself.
    //
    // It used to. That was the whole bug behind "the sound effects are too
    // quiet": a phone suspends the AudioContext when the app goes to the
    // background, `unlock()` is the only thing that resumes it, and after the
    // first tap nothing could call it again. The game went permanently silent
    // the first time you looked at something else, with no way back but a
    // reload.
    const unlock = () => audio.unlock();
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);

    globalThis.addEventListener('beforeunload', () => { if (this.game) this.save(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { if (this.game) this.save(); return; }
      // Back in the foreground. The audio context was very likely suspended
      // while we were away, and this is the only thing that brings it back —
      // before the game check, because a silent menu is still silent.
      audio.unlock();
      if (!this.game) return;
      // The ship has been working the whole time we were gone.
      this.resumeCommission();
    });
  }

  // ------------------------------------------------------------ navigation

  go(screen) {
    this.screen = screen;
    // The tactical view is deliberately NOT dropped here. Its canvas lives in a
    // persistent host that survives the DOM swap, so the view stays valid — and
    // nulling it leaked a WebGL context and inserted a second overlay canvas on
    // every visit, with the stale overlays painting over the live one. The
    // `tacticalViewCanvas` guard in render() rebuilds it if the host really is
    // replaced, and disposes the old one first.
    this.map = null;
    this.buildNav();
    this.render();
  }

  /**
   * The one WebGL context, made once and lent to whichever view is on screen.
   *
   * There is exactly one GL canvas in this application and three views that
   * draw through it — the tactical plot, the main viewer and the first-person
   * bridge. Each making its own renderer is how you get two contexts on one
   * element, which browsers cap and then silently drop the oldest of; the
   * display goes black and nothing says why. So the App owns it.
   */
  sharedRenderer() {
    if (!this.tacticalCanvas) return null;
    if (this.renderer && this.rendererCanvas === this.tacticalCanvas && !this.renderer.lost) {
      return this.renderer;
    }
    this.renderer?.dispose?.();
    this.renderer = Renderer.create(this.tacticalCanvas);
    this.rendererCanvas = this.tacticalCanvas;
    return this.renderer;
  }

  /** Release the GL context and overlay canvas. For teardown, not navigation. */
  disposeTacticalView() {
    this.tactical?.dispose?.();
    this.tactical = null;
    this.tacticalViewCanvas = null;
  }

  render() {
    if (!this.game) return;
    const g = this.game;

    // The era drives the whole interface, and it is only known once a game
    // exists — applySettings() runs before that, on the menu.
    if (document.documentElement.dataset.era !== g.era) {
      document.documentElement.dataset.era = g.era ?? 'tos';
    }

    this.shipNameEl.textContent = `${g.ship.name} ${g.ship.registry}`;
    this.stardateEl.textContent = `SD ${g.stardate}`;

    // The room decides what the ship sounds like. Driven from render rather
    // than from an event because there is no single place the captain's
    // location changes — a walk finishes on a tick, a turbolift on a tap, a
    // transporter on an order — and `setRoom` is a no-op when nothing moved.
    const here = g.walk?.room;
    if (here) {
      audio.setRoom(here.id, {
        outdoors: here.surface === true,
        airless: here.surface === true && here.kind === 'moon',
      });
    }

    // Combat and missions take the screen outright — you do not get to browse
    // the crew roster mid-broadside. An encounter or a transit only replaces
    // the bridge, so the map, ship, and record stay reachable while you decide.
    let screen = this.screen;
    if (g.over) screen = 'gameover';
    // Combat no longer takes the screen AT ALL. You are on the bridge and they
    // are on the viewer, which is where a fight is supposed to happen — being
    // teleported to a plot view the moment somebody decloaks is the thing this
    // restructure exists to stop.
    //
    // Nor does it forbid the plot: the tactical console is a station on the
    // bridge you can walk to. Redirecting *away* from it during a fight was the
    // same mistake in the other direction, and it left the tactical view never
    // built and the renderer reporting a mode it was not in.
    // MODES.MISSION no longer takes over the screen. The stage hangs on the
    // bridge; overriding here is what used to dispose the first-person view
    // mid-episode and leave a frozen photograph of a room nobody was drawing.
    // An ENCOUNTER and a TRANSIT no longer replace the bridge either. A ship
    // hailing you is something you see on the viewer and answer from the chair,
    // and being at warp is something you are doing while sitting in it — both
    // used to swap the whole screen out, which disposed the first-person view
    // and left the canvas showing a frozen frame of a bridge nobody was in.
    // Their panels appear in the bridge's own strip instead.
    //
    // A MISSION still takes the screen, because a mission stage IS text.

    const old = this.screenEl;
    let node;
    switch (screen) {
      case 'tactical': node = screens.tacticalScreen(this); break;
      case 'chair': node = el('div', { class: 'screen' }, [screens.chairConsole(this)]); break;
      case 'viewscreen': node = screens.viewscreenScreen(this); break;
      case 'galaxy': node = screens.galaxyScreen(this); break;
      case 'crew': node = el('div', { class: 'screen' }, [screens.crewScreen(this)]); break;
      case 'sheet': node = el('div', { class: 'screen' }, [characterSheetScreen(this)]); break;
      case 'reputation': node = el('div', { class: 'screen' }, [reputationScreen(this)]); break;
      case 'captain': node = el('div', { class: 'screen' }, [screens.captainScreen(this)]); break;
      case 'ship': node = el('div', { class: 'screen' }, [screens.shipScreen(this)]); break;
      case 'options': node = el('div', { class: 'screen' }, [screens.optionsScreen(this)]); break;
      case 'encounter': node = el('div', { class: 'screen' }, [screens.encounterScreen(this)]); break;
      case 'mission': node = el('div', { class: 'screen' }, [screens.missionScreen(this)]); break;
      case 'transit': node = el('div', { class: 'screen' }, [screens.transitScreen(this)]); break;
      case 'gameover': node = el('div', { class: 'screen' }, [screens.gameOverScreen(this)]); break;
      case 'log': node = el('div', { class: 'screen' }, [screens.logScreen(this)]); break;
      case 'reference': node = el('div', { class: 'screen' }, [screens.referenceScreen(this)]); break;
      case 'bridge':
      default: node = el('div', { class: 'screen' }, [screens.bridgeScreen(this)]); break;
    }

    old.replaceWith(node);
    this.screenEl = node;

    // The first-person bridge shares the one GL canvas with the tactical plot.
    // Two contexts on one element is a bug this project has already fixed, and
    // browsers cap how many can live at once — so the renderer is created once
    // and the two views take turns owning it.
    if (screen === 'bridge' && this.tacticalCanvas) {
      if (!this.fpv || this.fpvCanvas !== this.tacticalCanvas) {
        this.disposeTacticalView();
        this.fpv?.dispose?.();
        const renderer = this.sharedRenderer();
        this.fpv = renderer ? new FirstPersonView(this.tacticalCanvas, renderer) : null;
        this.fpvCanvas = this.tacticalCanvas;
        if (this.fpv) {
          this.fpv.onLook = (dYaw, dPitch) => {
            g.walk.yaw += dYaw;
            this.fpv.look(0, dPitch);
          };
          this.fpv.onUse = () => this.useWhatIsInFront();
          // The view is rebuilt whenever the canvas is, so the setting has to
          // be applied here as well as when it is changed.
          this.fpv.shake = !this.settings.reduceMotion;
        }
      }
    } else if (this.fpv) {
      this.fpv.dispose();
      this.fpv = null;
      this.fpvCanvas = null;
    }

    // Canvas-backed screens need their renderers rebuilt after a DOM swap.
    if ((screen === 'tactical' || screen === 'viewscreen') && this.tacticalCanvas) {
      // Three dimensions when the device can, two when it cannot. The 2D view
      // is not a stub — it is the display this game shipped with, and it stays
      // complete, because "no WebGL" must mean a different picture and not a
      // broken game.
      if (!this.tactical || this.tacticalViewCanvas !== this.tacticalCanvas) {
        this.tactical?.dispose?.();
        this.tactical = (this.settings.render3d === false
          ? null
          : TacticalView3D.create(this.tacticalCanvas, this.sharedRenderer()))
          ?? new TacticalView(this.tacticalCanvas);
        this.tacticalViewCanvas = this.tacticalCanvas;
        this.renderMode = this.tactical instanceof TacticalView3D ? '3d' : '2d';
        this.tactical.onSelect = (ship) => {
          g.engagement?.setTarget(ship);
          audio.play('ui_select');
          this.render();
        };
      }
      // The camera follows the screen you are on: the plot orbits, the viewer
      // looks out. Same renderer, same context — one call, not one more canvas.
      this.tactical.setCameraMode?.(screen === 'viewscreen' ? 'forward' : 'orbit');
      // The sky belongs to the system, not to the screen. Setting it here means
      // a fight at Rigel happens against Rigel's worlds whether or not you
      // happened to open the viewer first.
      this.tactical.setVista?.(g.location?.id, g.location?.type);
    }
    if (screen === 'galaxy' && this.galaxyCanvas) {
      this.map = new GalaxyMap(this.galaxyCanvas);
      this.map.selectedId = this.selectedSystemId ?? g.locationId;
      this.map.game = g;
      this.map.focus(this.selectedSystemId ?? g.locationId);
      this.map.onSelect = (sys) => {
        this.selectedSystemId = sys.id;
        audio.play('ui_tap');
        haptic('tap');
        this.renderSystemDetail(sys);
      };
    }

    // A console showing state that has just changed has to be redrawn with it —
    // but ONLY then.
    //
    // Rebuilding it on every render made the modal a new set of DOM nodes
    // several times a second, and in combat, where the screen refreshes
    // continuously, that meant every control on an open console detached from
    // under the finger before the tap landed. A console you cannot press is
    // worse than one showing a stale number.
    if (this.consoleOpen && this.consoleDirty && !this._refreshingConsole) {
      this.consoleDirty = false;
      this._refreshingConsole = true;
      try { this.openConsole(this.consoleOpen.key, this.consoleOpen.station); }
      finally { this._refreshingConsole = false; }
    }

    this.orderBar.style.display = (screen === 'gameover' || screen === 'options') ? 'none' : '';
    this.needsRender = false;
  }

  /**
   * Operate whatever the captain is standing at.
   *
   * This is the whole "walk to a console" interaction. A station opens the
   * panel that already exists for that department — the power grid, the weapons
   * console, the galaxy map — as a console rather than as a tab, because the
   * panel was never the problem. Being able to reach it from anywhere was.
   */
  useWhatIsInFront() {
    const g = this.game;
    if (!g) return;
    const w = g.walk;

    if (w.atStation) {
      const key = STATION_PANEL[w.atStation.panel] ?? w.atStation.panel;
      if (!key) {
        audio.play('ui_deny');
        g.officerSays(w.atStation.crew ?? 'ops', 'That station is not mine to work, Captain.', 'object');
        this.render();
        return;
      }
      audio.play('computer_query');
      haptic('tap');
      this.openConsole(key, w.atStation);
      return;
    }

    if (w.atExit) {
      const r = w.room.lift ? { ok: false, needsDestination: true } : w.useExit();
      if (r.ok) { audio.play('door'); haptic('confirm'); this.render(); return; }
      // A lift needs a deck. Offer the stops rather than guessing one.
      this.showMessage('Turbolift', ['Which deck, Captain?'],
        w.liftStops().map((e) => button(e.label ?? e.to, () => {
          this.closeModal();
          w.useExit(e.to);
          audio.play('door');
          this.render();
        }, { color: 'blue' })));
      return;
    }

    audio.play('ui_deny');
  }

  /** Open a station's console as a modal over the bridge. */
  openConsole(key, station) {
    const g = this.game;
    // Remembered so the console can be rebuilt when the state it shows changes.
    // Without this, throwing a warp switch set the factor and left the switch
    // drawn in its old position — the order worked and the console lied.
    this.consoleOpen = { key, station };
    const body = [];
    switch (key) {
      case 'galaxy': this.go('galaxy'); return;
      case 'tactical': this.go('tactical'); return;
      case 'log': this.go('log'); return;
      case 'captain': this.go('captain'); return;
      case 'crew': this.go('crew'); return;
      case 'ship': this.go('ship'); return;
      case 'chair': this.go('chair'); return;
      case 'power': body.push(screens.powerPanel(this)); break;
      case 'shop': body.push(screens.machineShopPanel(this)); break;
      case 'comms':
        // Hailing is an ORDER, not a console read-out: it goes through the same
        // dispatch a typed "open a channel" does, so there is one path.
        this.executeOrder({ action: 'hail' }, 'hailing frequencies open');
        return;
      case 'science': {
        body.push(el('p', { text: 'Sensor sweep of the system.' }));
        for (const line of this.scanSystem()) body.push(el('p', { class: 'muted', text: String(line) }));
        break;
      }
      case 'helm':
        // The eight warp flip switches live on the helm console, because that
        // is where they were on the prop. The chair shows them too — the chair
        // is where the order is given from — but this is where they are.
        body.push(warpSwitches(this));
        body.push(el('p', { class: 'hint', text: 'Throw a switch to set the standing warp factor. Every course is plotted at it.' }));
        break;
      case 'transport': {
        // The one console that puts you somewhere else. It refuses for reasons
        // rather than being absent, because "why can I not beam down" is a
        // question the room should answer standing in it.
        const g2 = this.game;
        const world = g2.orbitLabel;
        body.push(el('p', {
          text: world
            ? `Transporter ready. ${world} is below us.`
            : 'Transporter ready. The ship is not in orbit of anything.',
        }));
        if (g2.ashore) {
          body.push(button('Energise — beam up', () => {
            this.closeModal();
            this.executeOrder({ action: 'transport' }, 'energize');
          }, { color: 'blue', say: 'energise' }));
        } else {
          body.push(button('Energise — beam down', () => {
            this.closeModal();
            this.executeOrder({ action: 'beam_down' }, 'beam down');
          }, { color: world ? 'blue' : 'ghost', say: 'two to beam down' }));
          if (!world) {
            body.push(el('p', { class: 'hint', text: 'Make standard orbit first, and there will be somewhere to go.' }));
          }
        }
        break;
      }
      case 'survey': {
        // Not a console. This is the away team going over something, so it
        // shows the same auditable card every other check in the game shows —
        // the margin, and every term that produced it.
        const g3 = this.game;
        const r = g3.surveyFeature(station?.id);
        if (!r.ok) {
          body.push(el('p', { class: 'muted', text: r.error }));
          audio.play(r.done ? 'ui_back' : 'ui_deny');
          break;
        }
        const { feature, result } = r;
        audio.play(result.success ? 'scan_complete' : 'ui_deny');
        haptic(result.success ? 'confirm' : 'hit_light');
        body.push(rollCard(result));
        body.push(el('p', { text: result.success ? feature.found : feature.failed }));
        if (result.success) {
          const got = Object.entries(feature.yield ?? {})
            .map(([m, n]) => `${n} ${m}`).join(', ');
          if (got) body.push(el('p', { class: 'hint', text: `Transported aboard: ${got}.` }));
        }
        for (const c of result.casualties ?? []) {
          body.push(el('p', { class: 'hint', text: String(c) }));
        }
        break;
      }
      case 'turbolift':
      default:
        body.push(el('p', { class: 'muted', text: 'Working, Captain.' }));
        break;
    }
    this.showConsole(station?.label ?? 'Console', body);
  }

  /**
   * A console, as a modal over the room you are standing in.
   *
   * Not `showMessage`: that takes LINES and stringifies whatever it is given,
   * so handing it a panel produced a dialog reading "[object HTMLDivElement]".
   * A console is nodes.
   */
  showConsole(title, nodes) {
    this.closeModal(true);
    this.consoleTitle = title;
    const body = (nodes.length ? nodes : [el('p', { text: 'Working, Captain.' })])
      .map((n) => (n instanceof globalThis.Node ? n : el('p', { text: String(n) })));
    this.modalHandle = modal(title, body, [
      button('Step away', () => this.closeModal(), { color: 'ghost' }),
    ]);
  }

  renderSystemDetail(sys) {
    if (!this.galaxyDetail) return;
    clear(this.galaxyDetail);
    this.galaxyDetail.append(screens.systemDetail(this, sys));
  }

  // ------------------------------------------------------------ modals

  showMessage(title, lines, actions = null) {
    this.closeModal();
    // Anything that is a roll result is rendered as an auditable die card
    // rather than a sentence, so the arithmetic is always visible.
    const body = [].concat(lines).map((l) => (
      typeof l === 'object' && l?.natural !== undefined ? rollCard(l) : el('p', { text: String(l) })
    ));
    this.modalHandle = modal(title, body,
      actions ?? [button('Acknowledged', () => { audio.play('computer_ack'); this.closeModal(); }, { color: 'blue' })]);
    audio.play('computer_query');
    return this.modalHandle;
  }

  /**
   * @param {boolean} keepConsole true when the modal is being replaced rather
   *        than dismissed — a console you are standing at must survive giving
   *        an order FROM it. Throwing a warp switch dispatches `warp_factor`,
   *        which closes modals on the way through, and that closed the very
   *        console the switch was on.
   */
  closeModal(keepConsole = false) {
    if (!keepConsole && !this._refreshingConsole) this.consoleOpen = null;
    this.modalHandle?.close();
    this.modalHandle = null;
  }

  /**
   * The parser has a reading it is not confident enough to act on. Show it,
   * offer the runners-up, and let the captain settle it in one tap.
   *
   * This is the honest half of "type anything and it works": the table cannot
   * cover every sentence in English, so what it does instead is never silently
   * do the wrong thing.
   */
  confirmReading(result, raw) {
    const alts = (result.alternatives ?? []).map((a) => button(a.help, () => {
      this.closeModal();
      // Re-parse the original line against the chosen intent's canonical form,
      // so entities the captain actually gave — a system, a facing — survive.
      const forced = parseOrder(`${a.help.replace(/<[^>]+>/g, '')} ${raw}`);
      this.executeOrder(forced.confirm ? forced.order : forced, raw);
    }, { color: 'ghost' }));

    this.modalHandle = modal('Confirm order', [
      el('p', { class: 'muted', text: `You said: “${raw}”` }),
      el('p', { text: `I read that as: ${result.reading}` }),
      alts.length ? el('p', { class: 'muted', text: 'Or did you mean:' }) : null,
      ...alts,
    ].filter(Boolean), [
      button('Execute', () => {
        this.closeModal();
        this.executeOrder(result.order, raw);
      }, { color: 'blue' }),
      button('Belay that', () => {
        audio.play('ui_deny');
        this.closeModal();
      }, { color: 'ghost' }),
    ]);
    audio.play('computer_query');
    return this.modalHandle;
  }

  showOfficer(officer) {
    this.closeModal();
    this.modalHandle = modal(officer.name,
      screens.officerDetail(this, officer),
      [button('Close', () => this.closeModal(), { color: 'ghost' })]);
  }

  openHail(factionId) {
    this.closeModal();
    this.modalHandle = modal('Open Channel',
      screens.hailOptions(this, factionId, (optionId) => {
        const result = this.game.hail(optionId);
        this.closeModal();
        this.showMessage('Response', [result.text]);
        this.render();
      }),
      [button('Close the channel', () => this.closeModal(), { color: 'ghost' })]);
    audio.play('hail_incoming');
  }

  showCombatResult(outcome) {
    const g = this.game;
    const lines = {
      victory: ['All hostile contacts destroyed.'],
      routed: ['They have broken off and gone to warp.'],
      escaped: ['We are clear and at warp.'],
      destroyed: ['The ship is lost.'],
      // Talking your way out is the rarest ending in the game and used to
      // report itself as "The engagement has ended."
      parley: ['They are standing off. Nobody fired.', 'Rescue operations may proceed.'],
    }[outcome] ?? ['The engagement has ended.'];
    if (outcome !== 'destroyed') {
      const lost = g.ship.maxCrew - g.ship.crew;
      if (lost > 0) lines.push(`${lost} crew did not survive it.`);
      lines.push(`Hull at ${Math.round(g.ship.hullPct * 100)}%.`);
    }
    this.showMessage('Engagement Concluded', lines);
  }

  confirmNewGame(skipConfirm = false) {
    const start = () => { this.closeModal(); this.showNewGame(); };
    if (skipConfirm) return start();
    this.closeModal();
    this.modalHandle = modal('Abandon Command', [
      el('p', { text: 'This ends the current commission. The record cannot be recovered unless you exported it.' }),
    ], [
      button('Abandon command', () => start(), { color: 'red' }),
      button('Cancel', () => this.closeModal(), { color: 'ghost' }),
    ]);
    return null;
  }

  // ------------------------------------------------------------ game actions

  scanSystem() {
    const g = this.game;
    const sys = g.location;
    const lines = [`${sys.name}. ${sys.description}`];
    const neighbors = g.galaxy.neighbors(sys.id);
    lines.push(`Charted lanes from here: ${neighbors.map((n) => n.name).join(', ') || 'none'}.`);
    if (sys.hazard) lines.push(`Hazard: ${sys.hazard.replace(/_/g, ' ')}. Recommend we do not linger.`);
    const missions = g.availableMissions();
    if (missions.length) lines.push(`Standing orders available here: ${missions.map((m) => m.title).join(', ')}.`);
    g.clock.advanceStardate(0.1);
    audio.play('scan_complete');
    return lines;
  }

  useAbility(officer, ability) {
    const g = this.game;
    if (!officer.ready(ability.id)) { audio.play('ui_deny'); return; }

    // The officer gets a say.
    const reaction = officer.reactTo({ risk: ability.id === 'eject_core' ? 0.9 : 0.2 });
    officer.startCooldown(ability.id);

    if (ability.mods) {
      g.ship.addBuff({ id: ability.id, label: ability.name, until: ability.duration || 12, mods: ability.mods });
    }
    switch (ability.special) {
      case 'evasive': g.engagement?.evasive(true); break;
      case 'extinguish': g.ship.fires = 0; break;
      case 'eject': g.ship.ejectCore(); audio.play('explosion'); break;
      case 'reset_adaptation': {
        for (const s of g.engagement?.hostiles ?? []) s.adaptation = {};
        break;
      }
      case 'detect_cloak': {
        for (const s of g.engagement?.liveHostiles ?? []) if (s.cloaked) s.decloak();
        audio.play('scan');
        break;
      }
      case 'jam': {
        for (const s of g.engagement?.liveHostiles ?? []) {
          s.addBuff({ id: 'jammed', label: 'Sensors jammed', until: ability.duration, mods: { accuracy: 0.55 } });
        }
        break;
      }
      case 'subsystem': g.engagement?.targetSubsystem('weapons'); break;
      case 'scan': {
        const t = g.engagement?.target;
        if (t) {
          this.showMessage(`Scan — ${t.name}`, [
            `${t.cls.name}. ${t.cls.description}`,
            `Hull ${Math.round(t.hullPct * 100)}%, shields ${Math.round(t.shieldPct * 100)}%.`,
            `Weakest facing: ${FACINGS.reduce((w, f) => (t.shieldPctOf(f) < t.shieldPctOf(w) ? f : w), 'fore')}.`,
          ]);
        }
        break;
      }
      case 'spread': {
        // Fire every torpedo tube at once, ignoring arcs for this volley.
        const target = g.engagement?.target;
        if (target) {
          for (const w of g.ship.weapons.filter((x) => x.type === 'torpedo')) {
            w.cooldown = 0;
            g.engagement.fireWeapon(g.ship, w, target);
          }
          audio.play('torpedo_launch');
        }
        break;
      }
      default: break;
    }

    const line = officer.acknowledge(reaction === 'comply' ? 'order' : reaction);
    g.pushLog(`${officer.name}: ${ability.say ?? line}`, officer.station);
    if (this.settings.voice) audio.speak(ability.say ?? line);
    haptic('confirm');
  }

  /**
   * Career signature powers: one big effect, once per engagement.
   *
   * Each reuses machinery that already exists — buffs, repair, cooldowns —
   * rather than inventing a parallel system.
   */
  useSignature() {
    const g = this.game;
    const c = g?.character;
    const eng = g?.engagement;
    if (!c || c.signatureUsed) { audio.play('ui_deny'); return false; }

    const career = c.career;
    let line = '';

    switch (c.careerId) {
      case 'command': {
        // Take the Conn — every bridge officer is ready again.
        for (const o of g.crew.officers) o.cooldowns = {};
        line = 'Every station reports ready.';
        break;
      }
      case 'tactical': {
        // Called Shot — the next hit that lands is a guaranteed critical.
        if (!eng) { audio.play('ui_deny'); return false; }
        eng.guaranteedCrits += 1;
        if (!eng.targetedSubsystem) eng.targetSubsystem('weapons');
        line = `Called shot on their ${eng.targetedSubsystem}. Standing by.`;
        break;
      }
      case 'engineering': {
        const before = g.ship.hullPct;
        g.ship.repair(g.ship.maxHull * 0.3);
        g.ship.fires = 0;
        line = `Hull integrity ${Math.round(before * 100)}% to ${Math.round(g.ship.hullPct * 100)}%. Fires are out.`;
        break;
      }
      case 'science': {
        // Insight — see everything, and roll better for twenty seconds.
        g.ship.addBuff({
          id: 'insight', label: 'Insight', until: 20,
          mods: { accuracy: 1.25, critChance: 0.15 },
        });
        c.insightUntil = 20;
        if (eng?.target) {
          const t = eng.target;
          const weakest = FACINGS.reduce((w, f) => (t.shieldPctOf(f) < t.shieldPctOf(w) ? f : w), 'fore');
          line = `${t.name}: weakest facing is ${weakest}, hull at ${Math.round(t.hullPct * 100)}%.`;
        } else {
          line = 'Full spectrum analysis running.';
        }
        break;
      }
      case 'medical': {
        // Triage — one officer back on their feet, and fewer losses after.
        const wounded = g.crew.officers.find((o) => o.alive && o.injured);
        if (wounded) { wounded.injured = false; wounded.injurySeverity = 0; }
        g.ship.addBuff({
          id: 'triage', label: 'Triage', until: 30, mods: { crewProtect: 0.5 },
        });
        line = wounded
          ? `${wounded.name} is back on duty. Sickbay is holding.`
          : 'Sickbay is prepped. Casualties will be lighter.';
        break;
      }
      case 'diplomatic': {
        // Parley — they will hear you out whatever their doctrine says.
        if (!eng) { audio.play('ui_deny'); return false; }
        g.parleyForced = true;
        line = 'Channel forced open. They are listening whether they meant to or not.';
        this.openHail(eng.hostiles[0]?.faction);
        break;
      }
      case 'intelligence': {
        // Prior Knowledge — you move first, and they lose a beat.
        if (eng) {
          for (const s of eng.liveHostiles) {
            for (const w of s.weapons) w.cooldown = Math.max(w.cooldown, 6);
            if (s.cloaked) s.decloak();
          }
        }
        g.ship.addBuff({
          id: 'prior_knowledge', label: 'Prior Knowledge', until: 15,
          mods: { accuracy: 1.2, defense: 1.4 },
        });
        line = 'We know what they are about to do. Six seconds of it.';
        break;
      }
      default:
        audio.play('ui_deny');
        return false;
    }

    c.signatureUsed = true;
    g.pushLog(`${career.signature}: ${line}`, 'captain');
    if (this.settings.voice) audio.speak(line);
    audio.play('ui_confirm');
    audio.play('computer_ack');
    haptic('confirm');
    this.showMessage(career.signature, [line]);
    this.render();
    return true;
  }

  useDevice(id) {
    const g = this.game;
    if (!g.loadout.useDevice(id)) { audio.play('ui_deny'); return; }
    switch (id) {
      case 'shield_battery':
        for (const f of FACINGS) {
          g.ship.shields[f] = Math.min(g.ship.maxShield, g.ship.shields[f] + g.ship.maxShield * 0.4);
        }
        g.pushLog('Shield battery discharged. Facings reinforced.', 'engineering');
        break;
      case 'weapons_battery':
        g.ship.addBuff({ id: 'weapons_battery', label: 'Weapons battery', until: 20, mods: { damage: 1.4 } });
        break;
      case 'engine_battery':
        g.ship.addBuff({ id: 'engine_battery', label: 'Engine battery', until: 20, mods: { impulse: 1.5, turn: 1.3 } });
        break;
      case 'hull_patch':
        g.ship.repair(g.ship.maxHull * 0.2);
        g.ship.fires = 0;
        g.pushLog('Emergency hull patch applied. Fires out.', 'engineering');
        break;
      default: break;
    }
    audio.play('power_reroute');
    haptic('confirm');
  }

  resolveEncounter(choiceId) {
    if (choiceId === 'hail') {
      this.openHail(this.game.encounter?.factionId);
      return;
    }
    const result = this.game.resolveEncounter(choiceId);
    if (result.messages?.length) this.showMessage('Report', result.messages);
    this.render();
  }

  startMission(id) {
    this.game.startMission(id);
    this.render();
  }

  chooseMission(choiceId) {
    const result = this.game.chooseMission(choiceId);
    if (!result) { audio.play('ui_deny'); return; }
    if (result.complete && result.ending) {
      this.showMessage(result.ending.label ?? 'Mission complete', [result.ending.text]);
    }
    this.render();
  }

  changeShip(classId) {
    const g = this.game;
    const oldName = g.ship.name;
    const oldRegistry = g.ship.registry;
    g.ship = new Ship(classId, { name: oldName, registry: oldRegistry, faction: 'federation', isPlayer: true });
    g.loadout.refitTo(g.ship.cls.slots);
    g.applyAllMods();
    g.clock.advanceStardate(4);
    g.pushLog(`Transferred command to a ${g.ship.cls.name}.`, 'captain');
    audio.play('dock');
    this.showMessage('Change of Command', [
      `${oldName} is now a ${g.ship.cls.name}.`,
      'Four days in the yard. Any consoles that no longer fit are in storage.',
    ]);
    this.render();
  }

  // ------------------------------------------------------------ orders

  submitOrder() {
    const text = this.orderInput.value.trim();
    if (!text) return;
    this.orderInput.value = '';

    // With the channel forced open, the order line stops being an order line.
    // Whatever you type is what you say, verbatim, and it is judged against
    // your record rather than parsed into a command. This is the one place in
    // the game where the literal words are the input.
    if (this.game?.gambitOpen) {
      const outcome = this.game.makeAppeal(text);
      this.showAppealOutcome(outcome);
      return;
    }

    const order = parseOrder(text);
    this.executeOrder(order, text);
  }

  /**
   * What the commander made of it, and — win or lose — which of the things you
   * said the record could actually back up.
   */
  showAppealOutcome(outcome) {
    const body = [
      el('p', { class: 'muted', text: `You said: “${outcome.text}”` }),
      ...outcome.lines.map((l) => el('p', { text: l })),
      el('p', {}, [el('b', { text: outcome.reply })]),
    ];

    if (outcome.hits.length) {
      body.push(el('p', { class: 'muted', text: 'What the record could confirm:' }));
      for (const h of outcome.hits) {
        body.push(el('p', {
          class: 'muted',
          text: `${h.supported ? '✓' : '✗'} ${h.label} — ${h.value >= 0 ? '+' : ''}${h.value}`,
        }));
      }
    }

    audio.play(outcome.success ? 'computer_ack' : 'ui_deny');
    haptic(outcome.success ? 'confirm' : 'deny');
    this.modalHandle = modal(
      outcome.success ? 'They Are Standing Down' : 'The Channel Closes',
      body,
      [button('Acknowledged', () => this.closeModal(), { color: outcome.success ? 'green' : 'red' })],
    );
    this.needsRender = true;
  }

  executeOrder(order, raw) {
    const g = this.game;
    const eng = g.engagement;
    // An order given FROM a console changes what that console is showing.
    this.consoleDirty = true;

    // The parser read something plausible but is not sure enough to act on it.
    // Ask, rather than guess — a wrong order in combat costs more than a
    // question does.
    if (order.confirm) {
      this.confirmReading(order, raw);
      return;
    }

    if (order.unknown) {
      audio.play('ui_deny');
      g.pushLog(`"${raw}" — the computer does not recognise that order.`, 'computer');
      if (order.suggestions?.length) {
        g.pushLog(`Did you mean: ${order.suggestions.join('  ·  ')}`, 'computer');
      }
      this.render();
      return;
    }
    if (order.error) {
      audio.play('ui_deny');
      g.pushLog(order.error, 'helm');
      this.render();
      return;
    }

    const ack = (station, text) => {
      const officer = g.officerSays(station, text);
      if (this.settings.voice && officer) audio.speak(text);
      audio.play('computer_ack');
      haptic('confirm');
    };

    switch (order.action) {
      case 'course': {
        const r = g.setCourse(order.system, order.warp);
        if (r.ok) { audio.play('warp_engage'); haptic('warp'); audio.setAlertLevel('warp'); }
        else audio.play('ui_deny');
        break;
      }
      case 'orbit': {
        const r = g.enterOrbit();
        if (r.ok) { audio.play('ui_confirm'); haptic('confirm'); }
        else audio.play('ui_deny');
        break;
      }
      case 'break_orbit': {
        const r = g.breakOrbit();
        if (r.ok) { audio.play('ui_confirm'); haptic('confirm'); }
        else { audio.play('ui_deny'); g.pushLog(r.error, 'helm'); }
        break;
      }
      case 'warp_factor': {
        // This used to be an acknowledgement and nothing else — the helm said
        // "warp eight standing by" and the next course still went out at six.
        // It sets the standing factor now, which is what the flip switches on
        // the console do and what the word means.
        const r = g.setWarpFactor(order.warp);
        audio.play(r.limited ? 'ui_deny' : 'ui_confirm');
        ack('helm', r.limited
          ? `Warp ${r.max} is all she has, Captain. Standing by at warp ${r.factor}.`
          : `Warp ${r.factor} standing by.`);
        break;
      }
      case 'throttle': {
        // Engines answering an order is a sound the game had and never made.
        const opening = order.value > g.ship.throttle + 0.15;
        g.ship.throttle = order.value;
        if (opening) audio.play('impulse_burn', { throttle: 400 });
        ack('helm', order.value === 0 ? 'All stop.' : `Ahead ${Math.round(order.value * 100)} percent.`);
        break;
      }
      case 'heading':
        eng?.setHeading(order.value);
        // "Bearing 210 mark 15" always parsed its mark, carried it in the order
        // object, and had it dropped here. The mark is the elevation, and it is
        // the only reason the third axis is in the sentence.
        if (order.mark) eng?.setPitch(order.mark);
        ack('helm', order.mark
          ? `Coming to bearing ${order.value} mark ${order.mark}.`
          : `Coming to bearing ${order.value}.`);
        break;
      case 'turn': {
        if (!eng) { ack('helm', 'We are not manoeuvring, Captain.'); break; }
        if (order.value === 0) {
          eng.setHeading(g.ship.heading);
          ack('helm', 'Steady as she goes.');
          break;
        }
        eng.setHeading(g.ship.heading + order.value);
        ack('helm', order.value < 0 ? 'Coming to port.' : 'Coming to starboard.');
        break;
      }
      case 'cloak': {
        // No Federation hull in this game carries one. The refusal is the
        // point: an officer says why, rather than the parser shrugging at an
        // order every captain in this setting knows the words to.
        if (!g.ship.cloakCapable) {
          audio.play('ui_deny');
          ack('engineering', 'We have no cloaking device, Captain. Treaty of Algeron.');
          break;
        }
        const worked = order.on ? g.ship.cloak() : g.ship.decloak();
        if (!worked) {
          audio.play('ui_deny');
          ack('engineering', order.on
            ? 'The cloak is still cycling, Captain.'
            : 'We are not cloaked.');
          break;
        }
        audio.play('power_reroute');
        ack('tactical', order.on ? 'Cloaking device engaged.' : 'Decloaking.');
        break;
      }
      case 'pitch': {
        if (!eng) { ack('helm', 'We are not manoeuvring, Captain.'); break; }
        eng.setPitch(order.value);
        const said = order.value === 0 ? 'Levelling off.'
          : order.value > 0 ? `Coming up ${Math.round(order.value)} degrees.`
            : `Taking her down ${Math.round(-order.value)} degrees.`;
        ack('helm', said);
        break;
      }
      case 'come_about':
        eng?.comeAboutTo(eng.target);
        ack('helm', 'Coming about.');
        break;
      case 'evasive':
        eng?.evasive(order.value);
        g.ship.evasive = order.value;
        ack('helm', order.value ? 'Evasive manoeuvres, aye.' : 'Resuming standard flight.');
        break;
      case 'warp_out':
        if (eng) { if (!eng.beginWarpOut()) audio.play('ui_deny'); }
        else ack('helm', 'Nothing to run from, Captain.');
        break;
      case 'dock': {
        const r = g.dock();
        if (r.ok) audio.play('dock'); else { audio.play('ui_deny'); g.pushLog(r.error, 'helm'); }
        break;
      }
      case 'alert':
        g.setAlert(order.level);
        break;
      case 'shields':
        g.ship.shieldsUp = order.up;
        ack('tactical', order.up ? 'Shields up.' : 'Shields down.');
        break;
      case 'reinforce':
        g.ship.reinforceShield(order.facing);
        audio.play('power_reroute');
        ack('engineering', `Transferring power to the ${order.facing} shield.`);
        break;
      case 'power':
        g.ship.power.set(order.subsystem, order.amount >= 100 ? 100 : g.ship.power.target[order.subsystem] + order.amount);
        audio.play('power_reroute');
        ack('engineering', `Rerouting power to ${order.subsystem}.`);
        break;
      case 'preset':
        g.ship.power.applyPreset(order.preset);
        audio.play('power_reroute');
        ack('engineering', `${order.preset} configuration, aye.`);
        break;
      case 'target_subsystem':
        eng?.targetSubsystem(order.subsystem);
        ack('tactical', `Targeting their ${order.subsystem}.`);
        break;
      case 'cycle_target':
        eng?.cycleTarget();
        break;
      case 'target_nearest': {
        if (eng) {
          const nearest = eng.liveHostiles
            .reduce((best, s) => (!best || g.ship.distanceTo(s) < g.ship.distanceTo(best) ? s : best), null);
          if (nearest) eng.setTarget(nearest);
        }
        break;
      }
      case 'fire': {
        if (!eng) { audio.play('ui_deny'); g.pushLog('No target, Captain.', 'tactical'); break; }
        const n = eng.fireAll();
        if (!n) audio.play('ui_deny');
        break;
      }
      case 'cease_fire':
        if (eng) eng.autoFire = false;
        ack('tactical', 'Holding fire.');
        break;
      case 'hail':
        this.openHail(eng?.hostiles[0]?.faction ?? g.encounter?.factionId);
        break;
      case 'hail_option':
        this.showMessage('Response', [g.hail(order.option).text]);
        break;
      case 'scan': {
        if (eng?.target) {
          const t = eng.target;
          this.showMessage(`Scan — ${t.name}`, [
            `${t.cls.name}. ${t.cls.description}`,
            `Hull ${Math.round(t.hullPct * 100)}%, shields ${Math.round(t.shieldPct * 100)}%.`,
          ]);
        } else {
          this.showMessage('Sensor Sweep', this.scanSystem());
        }
        audio.play('scan');
        break;
      }
      case 'status': {
        const s = eng ? eng.statusReport() : {
          hull: Math.round(g.ship.hullPct * 100),
          shields: FACINGS.map((f) => `${f} ${Math.round(g.ship.shieldPctOf(f) * 100)}%`).join(', '),
          crew: g.ship.crew, casualties: g.ship.maxCrew - g.ship.crew, condition: g.ship.condition,
        };
        this.showMessage('Damage Report', [
          `Hull integrity ${s.hull} percent. Condition ${s.condition}.`,
          `Shields: ${s.shields}.`,
          `Crew ${s.crew}${s.casualties ? `, ${s.casualties} casualties` : ''}.`,
          g.ship.fires ? `${g.ship.fires} fires burning.` : 'No fires reported.',
        ]);
        break;
      }

      // ---- the captain's chair, reachable equally from a typed order ----
      case 'intercom': {
        const dept = order.dept ?? 'security';
        this.showMessage(`${dept[0].toUpperCase()}${dept.slice(1)}`, [g.intercom(dept)]);
        break;
      }
      case 'log_entry': {
        const recorded = g.logEntry(order.text ?? raw);
        if (recorded) ack('captain', 'Log entry recorded.');
        else audio.play('ui_deny');
        break;
      }
      case 'jettison_pod': {
        const r = g.jettisonPod();
        if (r.ok) { audio.play('torpedo_launch'); haptic('warp'); }
        else { audio.play('ui_deny'); g.pushLog(r.reason, 'engineering'); }
        break;
      }
      case 'go_to_room': {
        const r = g.goToRoom(order.room);
        if (r.ok) {
          audio.play('door');
          haptic('confirm');
        } else {
          audio.play('ui_deny');
          ack('computer', r.reason);
        }
        break;
      }
      case 'chair': {
        const r = g.takeChair(order.sit !== false);
        if (r.ok) { audio.play('ui_confirm'); haptic('tap'); }
        else { audio.play('ui_deny'); ack('computer', r.reason); }
        break;
      }
      case 'help':
        audio.play('computer_ack');
        this.go('reference');
        break;
      case 'viewscreen': {
        // "On screen." One order, both directions: it opens the main viewer,
        // and said again it closes it and puts you back where you were —
        // the tactical plot mid-fight, the bridge otherwise.
        if (this.screen === 'viewscreen') {
          this.go(eng && !eng.over ? 'tactical' : 'bridge');
          ack('helm', 'Screen off, Captain.');
        } else {
          this.go('viewscreen');
          audio.play('ui_select');
          ack('helm', 'On screen.');
        }
        break;
      }
      case 'magnify': {
        // "Magnify" while the viewer is shut means "show me" — open it first,
        // then zoom, rather than silently magnifying something nobody can see.
        if (this.screen !== 'viewscreen') this.go('viewscreen');
        const v = this.tactical;
        if (!v?.setMagnification) { audio.play('ui_deny'); break; }
        const factor = order.factor && order.factor > 0
          ? order.factor
          : Math.min(12, v.magnification * 2);
        const now = v.setMagnification(factor);
        audio.play('computer_ack');
        ack('science', `Magnification factor ${now % 1 ? now.toFixed(1) : now.toFixed(0)}.`);
        break;
      }

      // ---- the machine shop ----
      case 'fabricate': {
        if (!order.recipe) {
          audio.play('ui_deny');
          g.officerSays('engineering', 'Build what, Captain?', 'object');
          break;
        }
        const r = g.fabricate(order.recipe);
        if (r.ok) { audio.play('computer_ack'); haptic('confirm'); }
        else { audio.play('ui_deny'); g.officerSays('engineering', r.reason, 'object'); }
        break;
      }
      case 'work_shop': {
        const status = g.fabricationStatus;
        if (!status) {
          audio.play('ui_deny');
          g.officerSays('engineering', 'Nothing on the bench, Captain.', 'object');
          break;
        }
        // Spend hours rather than merely asking. "Get on with it" is an order
        // to put the time in, and the time is real.
        const spend = Math.min(status.hoursRemaining, 8);
        const r = g.workTheShop(spend);
        if (r.done) {
          this.showMessage(r.done.recipe.name, [r.done.text]);
        } else {
          g.officerSays('engineering',
            `${(g.fabricationStatus.hoursRemaining).toFixed(1)} hours to go on the ${status.name.toLowerCase()}.`,
            'report');
        }
        break;
      }
      case 'salvage': {
        const haul = g.salvage({ tier: 3 });
        const summary = Object.entries(haul).filter(([, n]) => n > 0)
          .map(([m, n]) => `${n} ${m}`).join(', ');
        ack('engineering', `Recovered ${summary}.`);
        break;
      }

      case 'force_channel': {
        const r = g.forceChannel();
        if (r.ok) {
          audio.play('hail');
          haptic('confirm');
          this.showMessage('Channel Forced', [
            'They are receiving. Whatever you say next, they will hear.',
            'Type it into the order line. All of it. It is not a menu.',
          ]);
        } else {
          audio.play('ui_deny');
          this.showMessage('They Are Not Listening', r.reasons);
        }
        break;
      }

      case 'eject_core':
        if (g.ship.ejectCore()) { audio.play('explosion'); haptic('explosion'); ack('engineering', 'Core away!'); }
        else audio.play('ui_deny');
        break;
      case 'ability': {
        const ability = ABILITIES[order.ability];
        const officer = ability ? g.crew.officerFor(ability.id) : null;
        if (officer && ability) {
          this.useAbility(officer, ability);
        } else if (order.fallback) {
          // No trained officer, but the phrase is also a plain order.
          this.executeOrder(order.fallback, raw);
          return;
        } else {
          audio.play('ui_deny');
          g.pushLog('Nobody aboard is trained for that.', 'computer');
        }
        break;
      }
      case 'away_team': {
        g.buildAwayTeam(['science', 'medical', 'tactical'], order.captainLeads);
        ack('comms', 'Away team assembled and standing by in the transporter room.');
        break;
      }
      case 'mission_choice': {
        const m = g.missions.active;
        const choices = m?.choices?.() ?? [];
        const pick = choices[order.index ?? 0];
        if (!m || !pick || pick.locked) {
          audio.play('ui_deny');
          g.pushLog('There is nothing to decide, Captain.', 'computer');
          break;
        }
        this.chooseMission(pick.id);
        break;
      }
      case 'use':
        // The whole physical-console interface, reachable by saying so. Walking
        // to a station and pressing the button was the only way to operate
        // anything on this ship, which made the order line an interface for
        // half the game and a decoration for the other half.
        this.useWhatIsInFront();
        break;
      case 'survey_here': {
        const target = g.walk?.looking;
        if (!g.ashore || !target?.check) {
          audio.play('ui_deny');
          g.pushLog('There is nothing in front of you to survey, Captain.', 'science');
          break;
        }
        this.openConsole('survey', target);
        break;
      }
      case 'beam_down': {
        const r = g.beamDown();
        if (r.ok) { audio.play('transporter'); haptic('confirm'); }
        else { audio.play('ui_deny'); g.pushLog(r.error, 'transporter'); }
        break;
      }
      case 'transport':
        // "Energise" means bring us back when the captain is the one standing
        // on the planet, and means the usual acknowledgement when they are not.
        if (g.ashore) {
          const r = g.beamUp();
          if (r.ok) { audio.play('transporter'); haptic('confirm'); }
          else audio.play('ui_deny');
        } else {
          audio.play('transporter');
          ack('comms', 'Energising.');
        }
        break;
      default:
        audio.play('ui_deny');
        break;
    }
    this.render();
  }

  // ------------------------------------------------------------ character

  /**
   * Promotion grants a feat choice. The sheet screen offers the list; this
   * applies the pick and, for the repeatable ability feat, asks which scores.
   */
  chooseFeat(featId) {
    const g = this.game;
    if (!g || !(g.pendingFeats > 0)) return;
    const feat = FEAT_BY_ID[featId];
    if (!feat) return;

    if (featId === 'ability_score') {
      // Two +1s, chosen one at a time, so the UI stays a simple list.
      this.pickAbilityIncrease(2, []);
      return;
    }
    if (g.character.takeFeat(featId)) {
      g.pendingFeats--;
      g.applyAllMods();
      g.pushLog(`Qualified: ${feat.name}.`, 'captain');
      audio.play('ui_confirm');
      this.showMessage(feat.name, [feat.text]);
      this.render();
    }
  }

  pickAbilityIncrease(remaining, picked) {
    const g = this.game;
    this.closeModal();
    this.modalHandle = modal(`Field Commission — ${remaining} to assign`, [
      el('p', { class: 'hint', text: 'Raise an ability score by one. Scores are capped at 20.' }),
      ...ABILITY_LIST.map((a) => {
        const score = g.character.score(a.id);
        return button(`${a.name} — ${score} → ${Math.min(20, score + 1)}`, () => {
          const next = [...picked, a.id];
          if (remaining > 1) {
            this.pickAbilityIncrease(remaining - 1, next);
          } else {
            g.character.takeFeat('ability_score', next);
            g.pendingFeats--;
            g.applyAllMods();
            g.pushLog('Field commission: ability scores raised.', 'captain');
            this.closeModal();
            audio.play('ui_confirm');
            this.render();
          }
        }, { color: score >= 20 ? 'ghost' : 'blue', disabled: score >= 20 });
      }),
    ], [button('Cancel', () => this.closeModal(), { color: 'ghost' })]);
  }

  /** Apply what a completed reputation project actually gives you. */
  applyReputationGrant(trackId, project) {
    const g = this.game;
    const grant = project.grant ?? {};

    if (grant.console) {
      g.loadout.acquire(grant.console);
      g.pushLog(`${CONSOLES[grant.console]?.name ?? grant.console} received from ${trackId}.`, 'engineering');
    }
    if (grant.torpedoes) {
      g.ship.torpedoes = Math.min(g.ship.maxTorpedoes, g.ship.torpedoes + grant.torpedoes);
    }
    if (grant.antimatter) {
      g.ship.antimatter = Math.min(100, g.ship.antimatter + grant.antimatter);
    }
    if (grant.perk === 'cloak') {
      g.ship.cloakCapable = true;
      g.pushLog('A cloaking device has been installed. Nobody has signed for it.', 'engineering');
    }
    if (grant.title) {
      g.pushLog(`You are now styled "${grant.title}".`, 'captain');
    }
    g.applyAllMods();
    this.showMessage(project.name, [project.text]);
  }

  // ------------------------------------------------------------ persistence

  save() { return saveGame(this.game, 'auto'); }

  exportSave() {
    try {
      downloadSave(this.game);
    } catch {
      // Some mobile browsers block programmatic downloads; fall back to text.
      this.showMessage('Command Record', [exportSave(this.game).slice(0, 4000)]);
    }
  }

  importSave() {
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = importSave(await file.text());
        this.game = Game.load(data, { compression: this.settings.compression });
        this.go('bridge');
        this.showMessage('Record Restored', [`Resumed command at stardate ${this.game.stardate}.`]);
      } catch (err) {
        this.showMessage('Import Failed', [String(err.message ?? err)]);
      }
    });
    input.click();
  }

  // ------------------------------------------------------------ start

  showNewGame() {
    this.game = null;
    this.creator = new CharacterCreator(this, (draft) => this.startGame(draft));
    this.screenEl.replaceWith(this.creator.root);
    this.screenEl = this.creator.root;
    this.orderBar.style.display = 'none';
    this.navEl.style.display = 'none';
    this.shipNameEl.textContent = 'Starfleet Command';
    this.stardateEl.textContent = 'New Commission';
  }

  /** Character creation needs randomness before a Game (and its RNG) exists. */
  rngForCreation() {
    this.creationRng ??= new RNG(hashSeed(`creation:${Date.now()}:${Math.random()}`));
    return this.creationRng;
  }

  startGame(draft) {
    const seed = draft.seed?.trim()
      ? hashSeed(draft.seed.trim())
      : hashSeed(`${Date.now()}:${Math.random()}`);

    this.game = new Game({
      seed,
      character: {
        firstName: draft.firstName || 'Alexander',
        lastName: draft.lastName || 'Reyes',
        pronouns: draft.pronouns,
        speciesId: draft.speciesId,
        originId: draft.originId,
        careerId: draft.careerId,
        traits: draft.traits,
        baseScores: draft.baseScores,
      },
      difficulty: draft.difficulty,
      crewMode: draft.crewMode,
      era: draft.era,
      shipName: draft.shipName || 'Enterprise',
      registry: draft.registry || 'NCC-1701',
    });

    // The career track grants a matching starting skill rank.
    const skillId = BACKGROUND_SKILL[draft.careerId];
    if (skillId && SKILLS[skillId]) {
      this.game.progress.unspent++;
      this.game.progress.spend(skillId);
    }
    // Starfleet families start with an extra pip and the scrutiny to match.
    if (this.game.character.mechanic('startingRankBonus')) {
      this.game.progress.rankIndex = Math.min(
        this.game.progress.rankIndex + 1,
        10,
      );
    }
    if (this.game.character.mechanic('startingReprimand')) {
      this.game.ledger.record('order_disobeyed', {
        text: 'Prior reprimand on file at time of commission',
      });
    }
    this.game.applyAllMods();
    this.recentRolls = [];

    this.orderBar.style.display = '';
    this.navEl.style.display = '';
    this.creator = null;
    this.go('bridge');
    audio.unlock();
    audio.play('boatswain');

    const c = this.game.character;
    this.showMessage(`Stardate ${this.game.stardate}`, [
      `${this.game.progress.rankName} ${c.name}, you have the ${this.game.ship.name}.`,
      `${c.species.name}, ${c.career.name} track, serving at ${this.game.difficulty.name} difficulty.`,
      'Orders are on the screen at Sol. Type an order at any time — "helm, set course for Vulcan, warp eight" — or use the panels.',
    ]);
    this.save();
  }

  /**
   * Credit the time that passed while the app was closed, and show the captain
   * what happened. Called on load and whenever the tab comes back.
   *
   * Silent when nothing meaningful elapsed — coming back after ninety seconds
   * should not open a modal.
   */
  resumeCommission() {
    const r = this.game?.syncCampaign();
    if (!r || r.hours < 1) { this.needsRender = true; return; }
    this.showMessage('While You Were Away', r.lines);
    audio.play('computer_query');
    this.needsRender = true;
  }

  resumeOrStart() {
    if (hasSave('auto')) {
      const data = loadSave('auto');
      this.modalHandle = modal('Resume Command', [
        el('p', { text: data.label ?? 'A command record was found.' }),
      ], [
        button('Resume', () => {
          this.closeModal();
          try {
            this.game = Game.load(data, { compression: this.settings.compression });
            this.orderBar.style.display = '';
            this.go('bridge');
            if (data.recoveredFromBackup) {
              this.game.pushLog(
                'Primary command record was unreadable; restored from backup.',
                'computer',
              );
            }
            this.resumeCommission();
          } catch {
            this.showNewGame();
          }
        }, { color: 'green' }),
        button('New command', () => { this.closeModal(); this.showNewGame(); }, { color: 'ghost' }),
      ]);
    } else {
      this.showNewGame();
    }
  }

  // ------------------------------------------------------------ loop

  frame(timestamp) {
    const g = this.game;
    if (g && !g.over) {
      const steps = g.clock.frame(timestamp);
      for (let i = 0; i < steps; i++) g.update(SIM_STEP);

      // Canvas views redraw every frame; DOM only when something changed.
      const dt = Math.min(0.1, Math.max(0, (timestamp - (this.lastFrameAt ?? timestamp)) / 1000));
      this.lastFrameAt = timestamp;
      if (this.fpv) this.fpv.render(g, dt);
      else if (this.tactical) {
        if (g.engagement) this.tactical.render(g.engagement, g.clock.alpha, dt);
        // No engagement and the viewer is open: draw what is actually outside,
        // rather than the black rectangle a combat camera gives you at peace.
        else if (this.screen === 'viewscreen') this.tactical.renderVista?.(g, dt);
      }
      if (this.map) this.map.render(g);
      this.updateOverlay();

      // Combat and transit change numbers continuously.
      if (steps > 0 && (g.mode === MODES.COMBAT || g.mode === MODES.TRANSIT)) {
        this.tickCounter = (this.tickCounter ?? 0) + steps;
        if (this.tickCounter > 8) { this.tickCounter = 0; this.needsRender = true; }
      }
      if (this.needsRender) this.render();

      // Autosave every 30 seconds of wall clock.
      if (timestamp - this.lastAutosave > 30000) {
        this.lastAutosave = timestamp;
        this.save();
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /** The chips over the tactical canvas update every frame, cheaply. */
  updateOverlay() {
    const g = this.game;
    const overlay = this.tacticalOverlay;
    if (!overlay || !g?.engagement) return;
    const eng = g.engagement;
    const p = g.ship;
    clear(overlay);
    overlay.append(
      el('div', { class: 'row' }, [
        el('div', { class: `chip ${p.hullPct < 0.35 ? 'danger' : p.hullPct < 0.7 ? 'warn' : ''}`, text: `Hull ${Math.round(p.hullPct * 100)}%` }),
        el('div', { class: 'chip', text: `Shields ${Math.round(p.shieldPct * 100)}%` }),
        el('div', { class: 'chip', text: `${eng.liveHostiles.length} hostile` }),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'chip', text: `Speed ${Math.round(p.throttle * 100)}%` }),
        p.breaching ? el('div', { class: 'chip danger', text: `BREACH ${p.breachTimer.toFixed(0)}s` }) : null,
        eng.warpOutTimer > 0 ? el('div', { class: 'chip warn', text: `Warp in ${eng.warpOutTimer.toFixed(0)}s` }) : null,
        el('div', { class: 'chip', text: `Crew ${p.crew}` }),
      ].filter(Boolean)),
    );
  }
}

// ---------------------------------------------------------------- boot

function boot() {
  const root = document.getElementById('app');
  const app = new App(root);
  globalThis.__app = app;   // handy for the test harness
  globalThis.__audio = audio;   // so the harness can observe which cues fire
  app.resumeOrStart();
  requestAnimationFrame((t) => app.frame(t));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* file:// or unsupported */ });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { App };
