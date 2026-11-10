'use strict';
'require baseclass';
'require ui';
'require rpc';
'require poll';

/*
 * Navigation, bar modules and launcher of luci-theme-omarchy.
 *
 * Derived from luci-theme-bootstrap's menu-bootstrap.js,
 * Copyright 2008-2022 Jo-Philipp Wich <jo@mein.io>.
 * Licensed to the public under the Apache License 2.0.
 */

const callSystemInfo = rpc.declare({
	object: 'system',
	method: 'info'
});

const STORE = 'omarchy.palette';
const LOOK = 'omarchy.look';
const root = document.documentElement;

/* Whether Omarchy's wallpapers are in use, which then go with the palettes;
   see omarchy-settings.js. */
function wallFollows() {
	try {
		return (JSON.parse(localStorage.getItem(LOOK)) || {}).wall == 'omarchy';
	}
	catch (e) {
		return false;
	}
}

/* The glyphs of Omarchy's own menu and bar where a router has the same thing,
   from the same set where it has something else: Material Design Icons, numbered
   as in Nerd Fonts. Adding one here means running tools/gen-icons.py. */
const GLYPHS = {
	home: 0xF02DC, routes: 0xF046A, firewall: 0xF1A11, log: 0xF09ED, list: 0xF0279,
	chart: 0xF012A, radio: 0xF0003, cog: 0xF0493, key: 0xF030B, parcel: 0xF03D6,
	boot: 0xF0241, cron: 0xF00F0, disk: 0xF02CA, led: 0xF06E9, backup: 0xF006F,
	restart: 0xF0709, upgrade: 0xF06F4, lan: 0xF0317, wifi: 0xF05A9, dns: 0xF01D6,
	ip: 0xF0A60, test: 0xF04D9, port: 0xF0200, gauge: 0xF04C5, memory: 0xF035B,
	time: 0xF0150, power: 0xF0425, dot: 0xF09DF, palette: 0xF03D8, dashboard: 0xF056E,
	chip: 0xF061A, network: 0xF06F3, apps: 0xF003B, vpn: 0xF0582
};

/* The workspaces in the bar, by the name of their menu node. */
const SPACES = {
	status: 'dashboard', system: 'chip', network: 'network', services: 'apps',
	vpn: 'vpn', nas: 'disk', modem: 'radio'
};

/* By the path of the page, which unlike its title does not change with the
   language. A page of some other package gets the dot. */
const PAGES = {
	'status/overview': 'home', 'status/routes': 'routes', 'status/routesj': 'routes',
	'status/nftables': 'firewall', 'status/iptables': 'firewall', 'status/logs': 'log',
	'status/processes': 'list', 'status/realtime': 'chart', 'status/channel_analysis': 'radio',
	'system/system': 'cog', 'system/admin': 'key', 'system/package-manager': 'parcel',
	'system/startup': 'boot', 'system/crontab': 'cron', 'system/mounts': 'disk',
	'system/leds': 'led', 'system/flash': 'backup', 'system/reboot': 'restart',
	'system/attendedsysupgrade': 'upgrade', 'network/network': 'lan', 'network/wireless': 'wifi',
	'network/dhcp': 'ip', 'network/dns': 'dns', 'network/routes': 'routes',
	'network/diagnostics': 'test', 'network/firewall': 'firewall', 'network/switch': 'port'
};

const DOCK = [
	[ 'admin/network/network', 'lan' ], [ 'admin/network/wireless', 'wifi' ],
	[ 'admin/network/dhcp', 'ip' ], [ 'admin/network/firewall', 'firewall' ],
	[ 'admin/status/realtime', 'chart' ], [ 'admin/system/package-manager', 'parcel' ],
	[ 'admin/system/flash', 'backup' ], [ 'admin/system/reboot', 'restart' ]
];

function available(mem) {
	return (mem.available != null) ? mem.available : ((mem.free || 0) + (mem.buffered || 0));
}

function icon(name) {
	return E('i', { 'class': 'o-i', 'aria-hidden': 'true' }, [ String.fromCodePoint(GLYPHS[name] || GLYPHS.dot) ]);
}

/* The same list as in omarchy.css: what counts as a window on the desk. */
const WINDOWS = '#o-side, ' +
	'#view .cbi-section:not(.cbi-section .cbi-section):not([data-tab-title]), ' +
	'#view .cbi-map-tabbed, ' +
	'#view div:not(.cbi-section div):has(> .cbi-section[data-tab-title])';

return baseclass.extend({
	__init__() {
		this.pages = [];
		this.palettes = [];

		this.watchBars();
		this.renderStatus();
		this.watchWindows();

		if (L.env.dispatchpath.join('/') == 'admin/status/overview')
			this.homeDrawn = L.require('omarchy-home').then(L.bind(function(home) {
				this.home = home;
				return home.start(this);
			}, this));

		this.settle();

		ui.menu.load().then(L.bind(this.render, this));
	},

	/* The bar can wrap onto a second row when it runs out of room. What sticks
	   next to the two bars reads their real heights from these properties. */
	watchBars() {
		const measure = function(el, property) {
			if (el && window.ResizeObserver)
				new ResizeObserver(function() {
					root.style.setProperty(property, el.offsetHeight + 'px');
				}).observe(el);
		};

		measure(document.querySelector('header'), '--o-bar');
		measure(document.querySelector('footer'), '--o-foot');
	},

	render(tree) {
		const dp = L.env.dispatchpath;
		const rp = L.env.requestpath;
		const modes = ui.menu.getChildren(tree);
		let mode = null;

		modes.forEach(function(m, i) {
			if (rp.length ? m.name === rp[0] : i === 0)
				mode = m;
		});

		this.renderModes(modes, mode);

		if (mode) {
			const spaces = ui.menu.getChildren(mode);
			const space = spaces.filter(function(s) { return s.name === dp[1] })[0];

			this.renderSpaces(mode, spaces);

			if (space && dp[0] === mode.name)
				this.renderSide(space, [ mode.name, space.name ]);

			this.renderTray(mode, spaces);
		}

		modes.forEach(L.bind(function(m) {
			this.index(m, [ m.name ], []);
		}, this));

		this.pages.unshift({
			kind: 'action',
			label: _('Settings'),
			note: 'Wallpaper, home screen',
			text: 'settings wallpaper background home widgets dock',
			run: L.bind(this.openPanel, this, 'settings')
		}, {
			kind: 'action',
			label: _('Theme'),
			note: 'Switch the theme',
			text: 'theme palette colours colors',
			run: L.bind(this.openPanel, this, 'theme')
		});

		this.renderDock(tree);

		if (dp.length >= 3) {
			let node = tree;

			for (let i = 0; i < 3 && node; i++)
				node = L.isObject(node.children) ? node.children[dp[i]] : null;

			if (node)
				this.renderTabs(node, dp.slice(0, 3).join('/'), 0);
		}

		/* room is kept for the side panel from the start, this page has none */
		const side = document.querySelector('#o-side');

		if (side && !side.firstChild)
			side.style.display = 'none';

		this.bindKeys();
		this.reveal();
	},

	/* This page is complete: the picture of the page before can go (see header.ut). */
	reveal() {
		Promise.all([
			this.viewLoaded(),
			this.homeDrawn,
			L.resolveDefault(document.fonts.load('16px "Omarchy Icons"'), null)
		]).then(function() {
			root.setAttribute('data-o-drawn', '');

			if (window.oSwap)
				window.oSwap.skipTransition();
		});
	},

	/* A node without an action cannot be opened itself, so link to the first
	   page below it instead. */
	href(node, path) {
		for (let depth = 0; node && !L.isObject(node.action) && depth < 4; depth++) {
			const first = ui.menu.getChildren(node)[0];

			if (!first)
				break;

			path = path.concat(first.name);
			node = first;
		}

		return L.url(path.join('/'));
	},

	/* Level 1 of the menu: the workspaces in the bar. */
	renderSpaces(mode, spaces) {
		const ul = document.querySelector('#topmenu');
		const dp = L.env.dispatchpath;

		spaces.forEach(L.bind(function(space) {
			/* the tray holds the way out */
			if (space.name === 'logout')
				return;

			const path = [ mode.name, space.name ];
			const pages = ui.menu.getChildren(space);
			const active = (dp[0] === mode.name && dp[1] === space.name);

			const li = E('li', { 'class': (pages.length ? 'dropdown' : '') + (active ? ' active' : '') }, [
				E('a', {
					'href': this.href(space, path),
					'aria-label': _(space.title),
					'aria-current': active ? 'true' : null
				}, [ icon(SPACES[space.name]), E('span', {}, [ _(space.title) ]) ])
			]);

			if (pages.length)
				li.appendChild(E('ul', { 'class': 'dropdown-menu' }, pages.map(L.bind(function(page) {
					return E('li', {}, [
						E('a', { 'href': this.href(page, path.concat(page.name)) }, [
							icon(PAGES[space.name + '/' + page.name]), E('span', {}, [ _(page.title) ])
						])
					]);
				}, this))));

			ul.appendChild(li);
		}, this));

		ul.style.display = '';
	},

	/* Level 2: the pages of the current workspace. */
	renderSide(space, path) {
		const side = document.querySelector('#o-side');
		const pages = ui.menu.getChildren(space);
		const dp = L.env.dispatchpath;

		if (!side || !pages.length)
			return;

		side.setAttribute('aria-label', _(space.title));
		side.appendChild(E('h3', {}, [ _(space.title) ]));
		side.appendChild(E('ul', {}, pages.map(L.bind(function(page) {
			const active = (dp[2] === page.name);

			const more = ui.menu.getChildren(page).length > 0;

			return E('li', { 'class': ((active ? 'active ' : '') + (more ? 'o-more' : '')).trim() || null }, [
				E('a', {
					'href': this.href(page, path.concat(page.name)),
					'aria-current': active ? 'page' : null
				}, [ icon(PAGES[path[1] + '/' + page.name]), E('span', {}, [ _(page.title) ]) ])
			]);
		}, this))));
	},

	/* Level 3 and below: tabs above the page. */
	renderTabs(node, url, level) {
		const container = document.querySelector('#tabmenu');
		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(node);
		let activeNode = null;

		children.forEach(function(child) {
			const isActive = (L.env.dispatchpath[3 + level] == child.name);

			ul.appendChild(E('li', { 'class': 'tabmenu-item-%s%s'.format(child.name, isActive ? ' active' : '') }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));

			if (isActive)
				activeNode = child;
		});

		if (ul.children.length == 0)
			return;

		container.appendChild(ul);
		container.style.display = '';

		if (activeNode)
			this.renderTabs(activeNode, url + '/' + activeNode.name, level + 1);
	},

	renderModes(modes, mode) {
		const ul = document.querySelector('#modemenu');

		if (!ul || modes.length < 2)
			return;

		modes.forEach(function(m) {
			ul.appendChild(E('li', { 'class': (m === mode) ? 'active' : null }, [
				E('a', { 'href': L.url(m.name) }, [ _(m.title) ])
			]));
		});

		ul.style.display = '';
	},

	/* Every page that can be opened, for the launcher. */
	index(node, path, trail) {
		ui.menu.getChildren(node).forEach(L.bind(function(child) {
			const here = path.concat(child.name);
			const title = _(child.title);

			if (L.isObject(child.action) && child.action.type != 'firstchild')
				this.pages.push({
					kind: 'page',
					label: title,
					note: trail.join(' / '),
					text: trail.concat(title).join(' ').toLowerCase(),
					href: L.url(here.join('/'))
				});

			if (here.length < 5)
				this.index(child, here, trail.concat(title));
		}, this));
	},

	/* Right end of the bar: system readings and the way out. */
	renderTray(mode, spaces) {
		const tray = document.querySelector('#o-tray');
		const launch = document.querySelector('#o-launch');
		const out = spaces.filter(function(s) { return s.name === 'logout' })[0];

		if (launch) {
			launch.addEventListener('click', L.bind(this.open, this, null));
			launch.style.visibility = '';
		}

		if (!tray)
			return;

		this.pills = {};

		[ [ 'load', 'gauge' ], [ 'mem', 'memory' ], [ 'up', 'time' ] ].forEach(L.bind(function(pill) {
			this.pills[pill[0]] = tray.appendChild(E('span', {
				'class': 'o-pill',
				'data-pill': pill[0],
				'style': 'display:none'
			}, [ icon(pill[1]), E('b', {}, [ '' ]) ]));
		}, this));

		this.chip = E('span', {}, [ root.getAttribute('data-palette') || 'default' ]);

		tray.appendChild(E('button', {
			'type': 'button',
			'class': 'o-theme-btn',
			'title': _('Theme'),
			'aria-label': _('Theme'),
			'click': L.bind(this.openPanel, this, 'theme')
		}, [ icon('palette'), this.chip ]));

		tray.appendChild(E('button', {
			'type': 'button',
			'class': 'o-gear',
			'title': _('Settings'),
			'aria-label': _('Settings'),
			'click': L.bind(this.openPanel, this, 'settings')
		}, [ icon('cog') ]));

		if (out)
			tray.appendChild(E('a', {
				'class': 'o-logout',
				'href': L.url(mode.name, out.name),
				'title': _(out.title),
				'aria-label': _(out.title)
			}, [ icon('power') ]));

		this.refreshFn = L.bind(this.refresh, this);
		this.refreshFn();

		/* Read once per page load, then only as often as the page itself
		   polls: a page that is not refreshing stays quiet, so an idle tab
		   does not keep the session alive. */
		const follow = L.bind(function() { poll.add(this.refreshFn, 10) }, this);

		document.addEventListener('poll-start', follow);

		if (poll.active())
			follow();

		/* uptime and clock advance on their own, without asking the router */
		window.setInterval(L.bind(this.tick, this), 15000);
	},

	/* The pages a router's owner goes to most, in the status line of every page. */
	renderDock(tree) {
		const status = document.querySelector('#o-status');
		const here = L.env.dispatchpath.join('/');
		let look = {};

		if (!status)
			return;

		try {
			look = JSON.parse(localStorage.getItem(LOOK)) || {};
		}
		catch (e) {}

		const links = [];

		DOCK.forEach(L.bind(function(entry) {
			const path = entry[0].split('/');
			let node = tree;

			path.forEach(function(part) {
				node = (node && L.isObject(node.children)) ? node.children[part] : null;
			});

			if (node)
				links.push(E('a', {
					'href': this.href(node, path),
					'title': _(node.title),
					'aria-label': _(node.title),
					'aria-current': (here == entry[0] || here.indexOf(entry[0] + '/') == 0) ? 'page' : null
				}, [ icon(entry[1]) ]));
		}, this));

		if (links.length)
			status.parentNode.insertBefore(E('nav', {
				'id': 'o-dock',
				'aria-label': 'Dock',
				'hidden': (look.dock === false) ? '' : null
			}, links), status.nextSibling);
	},

	/* The list of themes, or the settings: one panel that grows out of the bar. */
	openPanel(part) {
		L.require('omarchy-settings').then(L.bind(function(settings) {
			settings.toggle(this, part);
		}, this));
	},

	refresh() {
		return callSystemInfo().then(L.bind(function(info) {
			if (!L.isObject(info) || !L.isObject(info.memory) || !Array.isArray(info.load))
				return;

			this.info = info;
			this.stamp = Date.now();
			this.tick();

			if (this.home)
				this.home.readings(info);
		}, this)).catch(function() {
			/* no permission to read system info: the readings stay hidden */
		});
	},

	tick() {
		const info = this.info;

		if (!info)
			return;

		const age = Math.max(0, Math.floor((Date.now() - this.stamp) / 1000));
		const mem = info.memory;
		const avail = available(mem);
		const used = mem.total ? Math.round(100 * (mem.total - avail) / mem.total) : 0;
		const load = info.load.map(function(n) { return (n / 65535).toFixed(2) });
		const up = (info.uptime || 0) + age;

		this.pill('load', load[0], '%s: %s'.format(_('Load Average'), load.join(' ')));
		this.pill('mem', used + '%',
			'%s: %1024.1mB / %1024.1mB'.format(_('Memory'), mem.total - avail, mem.total),
			(used >= 90) ? 'crit' : ((used >= 75) ? 'warn' : null));
		this.pill('up', this.span(up), '%s: %t'.format(_('Uptime'), up));

		const clock = document.querySelector('#o-clock');

		if (clock && info.localtime) {
			/* localtime is the router's wall clock expressed as a UTC epoch */
			const now = new Date((info.localtime + age) * 1000);
			let day = '';

			try {
				day = now.toLocaleDateString(root.lang || 'en', { weekday: 'long', timeZone: 'UTC' }) + ' ';
			}
			catch (e) {}

			clock.textContent = '%s%02d:%02d'.format(day, now.getUTCHours(), now.getUTCMinutes());
			clock.title = '%s: %04d-%02d-%02d %02d:%02d'.format(_('Local Time'),
				now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(),
				now.getUTCHours(), now.getUTCMinutes());
		}
	},

	pill(id, value, title, level) {
		const el = this.pills[id];

		el.lastChild.textContent = value;
		el.title = title;

		if (level)
			el.setAttribute('data-level', level);
		else
			el.removeAttribute('data-level');

		el.style.display = '';
	},

	span(seconds) {
		const d = Math.floor(seconds / 86400);
		const h = Math.floor(seconds % 86400 / 3600);
		const m = Math.floor(seconds % 3600 / 60);

		return d ? (d + 'd ' + h + 'h') : (h ? (h + 'h ' + m + 'm') : (m + 'm'));
	},

	/* Status line at the bottom: where this is and the launcher hint. */
	renderStatus() {
		const el = document.querySelector('#o-status');
		const main = document.querySelector('#maincontent');
		const mac = (navigator.platform || '').indexOf('Mac') == 0;

		if (!el)
			return;

		if (main && main.hasAttribute('data-o-title')) {
			const title = main.getAttribute('data-o-title');
			const colon = title.indexOf(': ');

			el.appendChild(E('span', { 'class': 'o-path' }, [ E('b', {}, [ title.slice(0, colon) ]), title.slice(colon) ]));
		}

		el.appendChild(E('button', {
			'type': 'button',
			'class': 'o-hint',
			'click': L.bind(this.open, this, null)
		}, [ E('kbd', {}, [ mac ? 'Cmd K' : 'Ctrl K' ]), ' ', _('Search') ]));

		/* The versions are cut to fit. Pointing at them shows all of it, if anything was cut. */
		const right = document.querySelector('.o-foot-right');

		if (right) {
			right.addEventListener('mouseenter', function() {
				right.classList.toggle('o-cut', right.firstElementChild.scrollWidth > right.firstElementChild.clientWidth);
			});

			right.addEventListener('mouseleave', function() {
				right.classList.remove('o-cut');
			});
		}
	},

	/* One window is active at a time: the last one the pointer or the keyboard
	   went to, and it stays active while the pointer crosses the gap to the next. */
	watchWindows() {
		const desk = document.querySelector('.o-desk');

		if (!desk)
			return;

		const follow = L.bind(function(ev) {
			const win = ev.target.closest ? ev.target.closest(WINDOWS) : null;

			if (win)
				this.activate(win);
		}, this);

		desk.addEventListener('mouseover', follow);
		desk.addEventListener('focusin', follow);
	},

	activate(win) {
		if (win === this.active)
			return;

		if (this.active)
			this.active.classList.remove('o-on');

		win.classList.add('o-on');
		this.active = win;
	},

	/* Windows pop in once, while the view first appears. A form is drawn again after
	   every change, and that must not set the animation off. */
	settle() {
		this.viewLoaded().then(function() {
			window.setTimeout(function() { document.body.classList.add('o-settled') }, 800);
		});
	},

	/* When the view has replaced its "loading" line. */
	viewLoaded() {
		const view = document.querySelector('#maincontent > #view');

		return new Promise(function(done) {
			if (!view || !view.querySelector(':scope > .spinning'))
				return done();

			const watch = new MutationObserver(function() {
				if (!view.querySelector(':scope > .spinning')) {
					watch.disconnect();
					done();
				}
			});

			watch.observe(view, { childList: true });
		});
	},

	bindKeys() {
		document.addEventListener('keydown', L.bind(function(ev) {
			const isOpen = (this.box != null && !this.box.hidden);
			const plain = !ev.ctrlKey && !ev.metaKey && !ev.altKey;
			const free = !isOpen && plain && !this.typing(ev.target) &&
				!document.body.classList.contains('modal-overlay-active');

			if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && (ev.key == 'k' || ev.key == 'K')) {
				ev.preventDefault();

				if (isOpen)
					this.close();
				else
					this.open(null);
			}
			else if (free && ev.key == '/') {
				ev.preventDefault();
				this.open(null);
			}
		}, this));
	},

	typing(el) {
		if (!el || !el.tagName)
			return false;

		return el.isContentEditable ||
			[ 'INPUT', 'TEXTAREA', 'SELECT' ].indexOf(el.tagName) >= 0 ||
			(el.closest != null && el.closest('.cbi-dropdown, .cbi-dynlist') != null);
	},

	/* Launcher: find a page by name, or switch the palette for this browser. */
	build() {
		this.input = E('input', {
			'type': 'text',
			'role': 'combobox',
			'aria-expanded': 'true',
			'aria-controls': 'o-launcher-list',
			'aria-autocomplete': 'list',
			'aria-label': _('Search'),
			'autocomplete': 'off',
			'autocapitalize': 'off',
			'spellcheck': 'false',
			'input': L.bind(this.filter, this),
			'keydown': L.bind(this.key, this)
		});

		this.ul = E('ul', { 'id': 'o-launcher-list', 'role': 'listbox' });

		this.box = E('div', {
			'id': 'o-launcher',
			'role': 'dialog',
			'aria-modal': 'true',
			'aria-label': _('Search'),
			'hidden': '',
			'mousedown': L.bind(function(ev) {
				if (ev.target === this.box)
					this.close();
			}, this)
		}, [
			E('div', { 'class': 'o-launcher-box' }, [
				E('label', { 'class': 'o-launcher-prompt' }, [ this.input ]),
				this.ul,
				E('div', { 'class': 'o-launcher-hint' }, [
					E('kbd', {}, [ '↑↓' ]), ' select ',
					E('kbd', {}, [ '↵' ]), ' open ',
					E('kbd', {}, [ 'esc' ]), ' close'
				])
			])
		]);

		document.body.appendChild(this.box);
	},

	open(scope) {
		/* never on top of a LuCI dialog: it may be waiting on an apply */
		if (document.body.classList.contains('modal-overlay-active'))
			return;

		if (!this.box)
			this.build();

		this.scope = (scope === 'palette') ? 'palette' : 'all';
		this.before = root.getAttribute('data-palette');
		this.kept = false;
		this.opener = document.activeElement;

		this.input.value = '';
		this.input.placeholder = (this.scope == 'palette') ? 'Palette\u2026' : 'Page or palette\u2026';
		this.box.hidden = false;
		this.input.focus();
		this.filter();

		if (!this.loaded) {
			this.loaded = true;

			L.require('omarchy-palettes').then(L.bind(function(data) {
				this.palettes = data.list.map(function(p) {
					return Object.assign({ kind: 'palette', label: p.name, text: ('palette theme ' + p.name + ' ' + p.mode).toLowerCase() }, p);
				});

				if (!this.box.hidden)
					this.filter();
			}, this)).catch(function() {});
		}
	},

	close() {
		if (!this.box || this.box.hidden)
			return;

		this.box.hidden = true;

		/* leaving without choosing undoes a preview */
		if (!this.kept)
			this.paint(this.before);

		if (this.opener && this.opener.focus)
			this.opener.focus();
	},

	/* How many other characters sit between the letters of a word when they
	   are read in order out of a text; -1 when they are not all there. */
	spread(word, text) {
		let best = -1;

		for (let from = text.indexOf(word.charAt(0)); from >= 0; from = text.indexOf(word.charAt(0), from + 1)) {
			let pos = from, gaps = 0;

			for (let j = 1; j < word.length && pos >= 0; j++) {
				const next = text.indexOf(word.charAt(j), pos + 1);

				gaps += next - pos - 1;
				pos = next;
			}

			if (pos >= 0 && (best < 0 || gaps < best))
				best = gaps;
		}

		return best;
	},

	/* Rank: a word found as typed beats its letters found in order, and
	   letters scattered across the whole text do not count at all. */
	score(words, text) {
		let total = 0;

		for (let i = 0; i < words.length; i++) {
			const word = words[i];
			const at = text.indexOf(word);

			if (at >= 0) {
				total += 100 - Math.min(at, 50) + ((at == 0 || text.charAt(at - 1) == ' ') ? 25 : 0);
				continue;
			}

			const gaps = this.spread(word, text);

			if (gaps < 0 || gaps > word.length)
				return -1;

			total += 40 - gaps;
		}

		return total;
	},

	filter() {
		const words = this.input.value.toLowerCase().split(' ').filter(function(w) { return w.length > 0 });
		const served = root.getAttribute('data-served-palette');
		const items = (this.scope == 'palette') ? this.palettes : this.pages.concat(this.palettes);
		const hits = [];

		items.forEach(L.bind(function(item, n) {
			const s = this.score(words, item.text);

			if (s >= 0)
				hits.push({ item: item, s: s, n: n });
		}, this));

		if (words.length)
			hits.sort(function(a, b) { return (b.s - a.s) || (a.n - b.n) });

		this.hits = hits.map(function(h) { return h.item });

		/* typing moves the selection, so a preview no longer belongs to it */
		this.paint(this.before);

		while (this.ul.firstChild)
			this.ul.removeChild(this.ul.firstChild);

		this.hits.forEach(L.bind(function(item, i) {
			let note = item.note;

			if (item.kind == 'palette')
				note = item.mode + ((item.id === this.before) ? ' · current' : '') + ((item.id === served) ? ' · router default' : '');

			this.ul.appendChild(E('li', {
				'id': 'o-hit-' + i,
				'role': 'option',
				'data-kind': item.kind,
				'click': L.bind(function() {
					this.select(i, false);
					this.run();
				}, this)
			}, [
				(item.kind == 'palette') ? E('span', {
					'class': 'o-swatch',
					'style': 'background:%s;color:%s;border-color:%s'.format(item.bg, item.fg, item.accent)
				}, [ 'Aa' ]) : '',
				E('span', {}, [ item.label ]),
				E('em', {}, [ note || '' ])
			]));
		}, this));

		if (!this.hits.length)
			this.ul.appendChild(E('li', { 'class': 'o-none' }, [ 'no match' ]));

		this.select(0, false);
	},

	select(i, preview) {
		const n = this.hits.length;

		this.at = n ? ((i % n) + n) % n : -1;

		for (let j = 0; j < n; j++)
			this.ul.children[j].setAttribute('aria-selected', (j == this.at) ? 'true' : 'false');

		if (this.at < 0) {
			this.input.removeAttribute('aria-activedescendant');
			return;
		}

		const li = this.ul.children[this.at];
		const item = this.hits[this.at];

		this.input.setAttribute('aria-activedescendant', li.id);

		if (li.scrollIntoView)
			li.scrollIntoView({ block: 'nearest' });

		/* walking the list with the keyboard tries each palette on */
		if (preview)
			this.paint((item.kind == 'palette') ? item.id : this.before, item.kind == 'palette');
	},

	run() {
		const item = this.hits[this.at];

		if (!item)
			return;

		if (item.kind == 'palette') {
			this.keep(item.id);
			this.kept = true;
			this.close();
		}
		else if (item.kind == 'action') {
			this.close();
			item.run();
		}
		else {
			this.close();
			location.href = item.href;
		}
	},

	key(ev) {
		if (ev.isComposing)
			return;

		switch (ev.key) {
		case 'ArrowDown':
		case 'ArrowUp':
			ev.preventDefault();
			this.select(this.at + ((ev.key == 'ArrowDown') ? 1 : -1), true);
			break;

		case 'Tab':
			ev.preventDefault();
			this.select(this.at + (ev.shiftKey ? -1 : 1), true);
			break;

		case 'Enter':
			ev.preventDefault();
			this.run();
			break;

		case 'Escape':
			ev.preventDefault();
			this.close();
			break;
		}
	},

	/* Show a palette without remembering it. No id stands for the default one.
	   Trying one on brings its wallpaper along while Omarchy's wallpapers are in
	   use; anything else puts back the wallpaper that is kept. */
	paint(id, trying) {
		if (trying && wallFollows()) {
			this.trying = true;
			L.require('omarchy-settings').then(function(settings) { settings.tryOn(id) });
		}
		else if (this.trying) {
			this.trying = false;
			L.require('omarchy-settings').then(function(settings) { settings.untry() });
		}

		if ((root.getAttribute('data-palette') || null) === (id || null))
			return;

		if (id)
			root.setAttribute('data-palette', id);
		else
			root.removeAttribute('data-palette');

		root.setAttribute('data-darkmode', getComputedStyle(root).getPropertyValue('--o-mode').trim() != 'light');

		if (this.chip)
			this.chip.textContent = id || 'default';

		if (this.home)
			this.home.theme(id || 'default');
	},

	/* Remember a palette for this browser. The choice is tied to the palette
	   the router serves, so changing the router-wide design resets it. */
	keep(id) {
		const served = root.getAttribute('data-served-palette');

		/* what was tried on is the choice now, nothing to put back */
		this.trying = false;
		this.paint(id);

		try {
			if (id === served)
				localStorage.removeItem(STORE);
			else
				localStorage.setItem(STORE, JSON.stringify({ id: id, served: served }));
		}
		catch (e) {}

		/* Omarchy's wallpapers go with the palettes, so this one has to follow */
		if (wallFollows())
			L.require('omarchy-settings').then(function(settings) { settings.loadOmarchy(id) });
	}
});
