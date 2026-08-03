// LCARS primitives — small DOM helpers so screens read like layout, not markup.

/** Create an element. `props` handles class/text/html/attrs/events uniformly. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** A titled panel. */
export function panel(title, children, variant = '') {
  return el('div', { class: `panel ${variant}` }, [
    title ? el('h2', { text: title }) : null,
    ...[].concat(children),
  ]);
}

/** A full-width LCARS action button. */
export function button(label, onClick, opts = {}) {
  const { color = '', sub = '', disabled = false, locked = false } = opts;
  return el('button', {
    class: `btn ${color} ${locked ? 'locked' : ''}`.trim(),
    disabled: disabled || locked,
    onclick: disabled || locked ? null : onClick,
  }, [
    label,
    sub ? el('small', { text: sub }) : null,
  ]);
}

/** Labelled bar readout with automatic colour banding. */
export function readout(label, pct, valueText = null) {
  const p = Math.max(0, Math.min(1, pct));
  const cls = p < 0.25 ? 'low' : p < 0.6 ? 'mid' : '';
  return el('div', { class: 'readout' }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: 'bar' }, [el('i', { class: cls, style: { width: `${p * 100}%` } })]),
    el('div', { class: 'val', text: valueText ?? `${Math.round(p * 100)}%` }),
  ]);
}

/**
 * The six-facing shield diagram, hull in the middle.
 *
 * Fore, aft, port and starboard keep the plan-view arrangement they have always
 * had, because that is how a captain reads a shield display. Dorsal and ventral
 * sit above and below the hull box in the centre column — the one place they
 * can go that says "over the top of us" and "under us" without a second
 * diagram.
 */
export function shieldDiagram(ship) {
  const cell = (facing, label) => {
    const p = ship.shieldPctOf(facing);
    const cls = p < 0.25 ? 'low' : p < 0.6 ? 'mid' : '';
    return el('div', { class: `sh ${facing} ${cls}` }, [
      label,
      el('b', { text: `${Math.round(p * 100)}` }),
    ]);
  };
  const hullPct = ship.hullPct;
  return el('div', { class: 'shields' }, [
    cell('fore', 'Fore'),
    cell('dorsal', 'Dorsal'),
    cell('port', 'Port'),
    el('div', { class: 'hullbox' }, [
      'Hull',
      el('b', { text: `${Math.round(hullPct * 100)}%` }),
    ]),
    cell('starboard', 'Stbd'),
    cell('ventral', 'Ventral'),
    cell('aft', 'Aft'),
  ]);
}

/** A power distribution slider. */
export function powerSlider(label, value, onInput) {
  const val = el('div', { class: 'val', text: String(Math.round(value)) });
  const input = el('input', {
    type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(value)),
    oninput: (e) => {
      val.textContent = e.target.value;
      onInput(parseInt(e.target.value, 10));
    },
  });
  return el('div', { class: 'power-row' }, [
    el('div', { class: 'label', text: label }), input, val,
  ]);
}

export function pill(text, variant = '') {
  return el('span', { class: `pill ${variant}`.trim(), text });
}

/** Modal dialog. Returns a handle with .close(). */
export function modal(title, bodyNodes, actions = []) {
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: 'modal' }, [
    el('header', { text: title }),
    el('div', { class: 'body' }, bodyNodes),
    el('div', { class: 'actions' }, actions),
  ]);
  back.append(box);
  document.body.append(back);
  const handle = {
    close() { back.remove(); },
    node: back,
  };
  back.addEventListener('click', (e) => { if (e.target === back) handle.close(); });
  return handle;
}

/** Text field with a label. */
export function field(label, input) {
  return el('div', { class: 'field' }, [el('label', { text: label }), input]);
}

export function textInput(value, onInput, placeholder = '') {
  return el('input', {
    type: 'text', value, placeholder,
    oninput: (e) => onInput(e.target.value),
  });
}

export function select(options, value, onChange) {
  const node = el('select', { onchange: (e) => onChange(e.target.value) },
    options.map((o) => el('option', {
      value: o.value, text: o.label, selected: o.value === value,
    })));
  return node;
}

/** Officer roster row. */
export function officerRow(officer, onClick = null) {
  const initials = officer.name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  const cls = !officer.alive ? 'dead' : officer.injured ? 'injured' : '';
  return el('div', {
    class: `officer ${cls}`.trim(),
    onclick: onClick ? () => onClick(officer) : null,
  }, [
    el('div', { class: 'pip', text: initials }),
    el('div', { class: 'who' }, [
      el('b', { text: officer.name }),
      el('small', {
        text: `${officer.rank} · ${officer.species}${!officer.alive ? ' · deceased' : officer.injured ? ' · in sickbay' : ''}`,
      }),
    ]),
    el('div', { class: 'traits', html: `EXP ${officer.expertise}<br>DAR ${officer.daring}` }),
  ]);
}

/** Log line. */
export function logLine(entry) {
  return el('div', { class: `logline ${entry.source ?? ''}`.trim() }, [
    el('span', { class: 'src', text: entry.source ?? 'log' }),
    entry.text,
  ]);
}
