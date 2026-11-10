'use strict';
'require baseclass';
'require dom';
'require fs';
'require network';
'require poll';
'require rpc';

/*
 * The home screen of luci-theme-omarchy: the System widget printed the way
 * fastfetch prints a machine, the internet connection next to it and the devices
 * on the network under them. Loaded on the status overview only.
 *
 * Licensed to the public under the Apache License 2.0.
 */

const LOOK = 'omarchy.look';
const root = document.documentElement;

const callRealtime = rpc.declare({
	object: 'luci',
	method: 'getRealtimeStats',
	params: [ 'mode', 'device' ],
	expect: { result: [] }
});

const callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
const callHints = rpc.declare({ object: 'luci-rpc', method: 'getHostHints', expect: { '': {} } });

const GLYPHS = {
	down: 0xF0045, up: 0xF005D, lan: 0xF0200, wifi: 0xF05A9, phone: 0xF011C, tablet: 0xF04F6,
	laptop: 0xF0322, desktop: 0xF01C5, tv: 0xF0502, printer: 0xF042A, game: 0xF0297, router: 0xF0469
};

/* What a device is, going by parts of its name. */
const KINDS = [
	[ 'phone', [ 'iphone', 'android', 'pixel', 'galaxy', 'redmi', 'oneplus', 'phone' ] ],
	[ 'tablet', [ 'ipad', 'tablet' ] ],
	[ 'laptop', [ 'macbook', 'laptop', 'notebook', 'thinkpad' ] ],
	[ 'desktop', [ 'imac', 'desktop', 'workstation' ] ],
	[ 'tv', [ 'tv', 'roku', 'chromecast', 'firestick' ] ],
	[ 'printer', [ 'printer', 'epson', 'laserjet', 'officejet' ] ],
	[ 'game', [ 'xbox', 'playstation', 'nintendo' ] ],
	[ 'router', [ 'openwrt', 'router', 'unifi', 'mikrotik' ] ]
];

/* The lines of the two windows on top, in the groups and colours Omarchy's own
   fastfetch config uses: hardware, software, time. */
const FETCH = [
	[ 'Host', 'hw' ], [ 'CPU', 'hw' ], [ 'Memory', 'hw' ], [ 'Disk', 'hw' ],
	[ 'OS', 'sw' ], [ 'LuCI', 'sw' ], [ 'Kernel', 'sw' ], [ 'Theme', 'sw' ],
	[ 'Uptime', 'age' ], [ 'Load', 'age' ], [ 'Time', 'age' ]
];

const WAN = [
	[ 'Proto', 'sw' ], [ 'IPv4', 'sw' ], [ 'IPv6', 'sw' ], [ 'Gateway', 'sw' ], [ 'DNS', 'sw' ],
	[ 'Link', 'hw' ], [ 'Uptime', 'age' ]
];

/* The OpenWrt logo as fastfetch draws it, see LICENSE.fastfetch. As there, $1 and
   $2 switch between its two colours and a colour carries over to the next line. */
const LOGO = [
	'            ..,,..',
	'      ,;odOMMMMMMMMObo:.',
	'  ,odOMMMMMO""\'\'""OMMMMMObo.',
	'.dMMMM"      .,,.      "OMMMb,',
	' \'0"   ,;ddMMMMMMMMbb:.   "0\'',
	'     oOMMMMO""\'\'""OMMMMOo',
	'   $2;. $1\'0"    .,,.    "0\' $2.:',
	' .OMM*   $1.odMMMMMMbo.   $2*MMO.',
	' MMMO     $1"0"````"0"     $2OMMM',
	'iOMM         $1.oo.         $2MMMi',
	'OMMl        $1:MMMM:        $2lMMO',
	'iMMM         $1\'oo\'         $2MMMi',
	' OMMb                    $2dMMO',
	' \'OMMO.                ,OMMO\'',
	'   "MMMb.            ,dMMM"',
	'     "MMMMbgo-,,-ogdMMMM"',
	'        "*MMMMMMMMMM*"',
	'            `\'""\'`'
];

const SVG = 'http://www.w3.org/2000/svg';
const CELLS = 60;

function icon(name) {
	return E('i', { 'class': 'o-i', 'aria-hidden': 'true' }, [ String.fromCodePoint(GLYPHS[name]) ]);
}

/* 3.1 / 11.7 GiB (26%): the unit only once where both have the same, and no
   fractions on numbers that are long enough without. */
function amount(used, total) {
	const parts = function(n) {
		const p = '%1024.1mB'.format(n).split(' ');

		return [ (+p[0] >= 100) ? String(Math.round(+p[0])) : p[0], p[1] ];
	};

	const a = parts(used), b = parts(total);

	return '%s%s / %s %s (%d%%)'.format(a[0], (a[1] == b[1]) ? '' : ' ' + a[1], b[0], b[1],
		total ? Math.round(100 * used / total) : 0);
}

function logoElement() {
	const el = E('div', { 'class': 'o-ff-logo', 'aria-hidden': 'true' });
	let colour = '1';

	LOGO.forEach(function(line) {
		line.split('$').forEach(function(part, i) {
			if (i > 0) {
				colour = part.charAt(0);
				part = part.slice(1);
			}

			el.appendChild(E('span', { 'class': 'o-ff-c' + colour }, [ part ]));
		});

		el.appendChild(document.createTextNode('\n'));
	});

	return el;
}

/* The bits per second between each sample of the realtime statistics and the next. */
function rates(samples, column) {
	const out = [];

	for (let i = 1; i < samples.length; i++) {
		const seconds = samples[i][0] - samples[i - 1][0];
		const bytes = samples[i][column] - samples[i - 1][column];

		out.push((seconds > 0 && bytes > 0) ? bytes * 8 / seconds : 0);
	}

	return out;
}

/* A speed with as many digits as fit on a short line. */
function rate(bits) {
	const text = '%.1mbit/s'.format(Math.round(bits));

	return (parseFloat(text) >= 100) ? '%.0mbit/s'.format(Math.round(bits)) : text;
}

/* A graph of the last values, newest on the right, that fills whatever box it is in. */
function chart() {
	const svg = document.createElementNS(SVG, 'svg');
	const path = document.createElementNS(SVG, 'path');

	svg.setAttribute('viewBox', '0 0 ' + CELLS + ' 100');
	svg.setAttribute('preserveAspectRatio', 'none');
	svg.appendChild(path);

	return { svg: svg, path: path };
}

function plot(graph, values) {
	const last = values.slice(-CELLS);
	const max = Math.max.apply(null, last.concat(1));
	let d = 'M' + (CELLS - last.length) + ' 100';

	/* no traffic is a thin line, not a hole */
	last.forEach(function(v) {
		d += 'V' + Math.round(100 - Math.max(v / max * 100, 3)) + 'h1';
	});

	graph.path.setAttribute('d', d + 'V100z');
}

function kindOf(host) {
	const name = (host.name || '').toLowerCase();

	for (let i = 0; i < KINDS.length; i++)
		for (let j = 0; j < KINDS[i][1].length; j++)
			if (name.indexOf(KINDS[i][1][j]) >= 0)
				return KINDS[i][0];

	return host.wifi ? 'wifi' : 'lan';
}

function addressValue(host) {
	const p = (host.ip || '').split('.');

	return (p.length == 4) ? (+p[0] * 16777216 + +p[1] * 65536 + +p[2] * 256 + +p[3]) : Infinity;
}

return baseclass.extend({
	start(menu) {
		const view = document.querySelector('#view');

		this.menu = menu;

		try {
			this.shown = (JSON.parse(localStorage.getItem(LOOK)) || {}).home || {};
		}
		catch (e) {
			this.shown = {};
		}

		/* settled when the windows of the home screen are built and filled */
		return new Promise(L.bind(function(done) {
			this.drawn = done;

			if (!view)
				return done();

			new MutationObserver(L.bind(this.sync, this)).observe(view, { childList: true, subtree: true });
			this.sync();
		}, this));
	},

	/* The stock System widget goes on fetching the data and replaces its table with
	   every poll, so the lines are read back from there, by their translated names.
	   Without a table that looks as expected the stock widget simply stays. */
	sync() {
		const kernel = _('Kernel Version');
		const rows = {};
		let table = null;

		document.querySelectorAll('#view .cbi-section .td:first-child').forEach(function(td) {
			if (td.textContent == kernel)
				table = td.closest('.table');
		});

		/* the view has arrived, with that widget or with it switched off */
		if (!this.top && !document.querySelector('#view > .spinning'))
			this.build();

		if (!table || table === this.table)
			return;

		this.table = table;

		if (!this.ff)
			this.buildFetch(table.closest('.cbi-section'));

		table.querySelectorAll('.tr').forEach(function(tr) {
			if (tr.children.length == 2)
				rows[tr.children[0].textContent] = tr.children[1].textContent;
		});

		const take = function(label) {
			const value = rows[_(label)];

			delete rows[_(label)];

			return (value && value != '?') ? value : '';
		};

		const firmware = take('Firmware Version').split(' / ');
		const target = take('Target Platform');

		/* the hostname is the title of the window */
		take('Hostname');

		this.put(this.ff, 'OS', firmware[0] + (target ? ' ' + target : ''));
		this.put(this.ff, 'LuCI', (firmware[1] || '').replace('LuCI ', ''));
		this.put(this.ff, 'Host', take('Model'));
		this.put(this.ff, 'CPU', take('Architecture'));
		this.put(this.ff, 'Kernel', take('Kernel Version'));
		this.put(this.ff, 'Uptime', take('Uptime'));
		this.put(this.ff, 'Load', take('Load Average'));
		this.put(this.ff, 'Time', take('Local Time'));

		/* rows that another LuCI adds keep the name it gave them */
		Object.keys(rows).forEach(L.bind(function(label) {
			this.put(this.ff, label, rows[label]);
		}, this));

		if (this.menu.info)
			this.readings(this.menu.info);
	},

	/* The first two rows of the screen go above the columns of widgets. */
	/* The window that prints the machine, in the place of the stock System widget. */
	buildFetch(section) {
		const who = (document.querySelector('#maincontent').getAttribute('data-o-title') || '').split(': ')[0];
		const parts = who.split('@');
		const strip = E('div', { 'class': 'o-ff-strip', 'aria-hidden': 'true' });
		const info = E('div', { 'class': 'o-ff-info' }, [
			E('div', { 'class': 'o-ff-title' }, [ E('b', {}, [ parts[0] ]), '@', E('b', {}, [ parts[1] || '' ]) ]),
			E('div', { 'class': 'o-ff-sep', 'aria-hidden': 'true' }, [ '-'.repeat(who.length) ]),
			strip
		]);

		this.ff = { info: info, end: strip, lines: {} };

		FETCH.forEach(L.bind(function(entry) {
			this.put(this.ff, entry[0], '', entry[1]);
		}, this));

		this.theme(root.getAttribute('data-palette') || 'default');

		section.classList.add('o-ff-win');
		section.appendChild(E('div', { 'id': 'o-fetch' }, [ logoElement(), info ]));

		this.top.insertBefore(section, this.top.firstChild);
	},

	/* The layout of the home screen and the windows of the theme itself. */
	build() {
		const view = document.querySelector('#view');

		this.buildWan();
		this.buildDevices();

		const top = this.top = E('div', { 'id': 'o-home-top' }, [ this.wan.win ]);
		const peek = function(ev, on) {
			const line = ev.target.closest('.o-ff-line');

			if (line)
				line.classList.toggle('o-cut', on && line.lastChild.scrollWidth > line.lastChild.clientWidth);
		};

		/* what is cut to fit shows in full under the pointer */
		top.addEventListener('mouseover', function(ev) { peek(ev, true) });
		top.addEventListener('mouseout', function(ev) { peek(ev, false) });

		/* The rest of the widgets, whatever is there, go into one block of columns.
		   Only that block has columns, so all of them start at the same height. */
		const columns = E('div', { 'id': 'o-home-cols' });

		Array.prototype.slice.call(view.children).forEach(function(el) {
			columns.appendChild(el);
		});

		dom.content(view, [ top, this.devices.win, columns ]);

		poll.add(L.bind(this.pollWan, this), 5);
		poll.add(L.bind(this.pollDevices, this), 10);

		const filled = L.bind(this.finish, this);

		Promise.all([ this.pollWan(), this.pollDevices() ]).then(filled, filled);
	},

	/* The home screen can be shown. */
	finish() {
		document.querySelector('#view').classList.add('o-home-ready');
		this.drawn();
	},

	/* One line of a window; a line without a value is left out, as fastfetch does. */
	put(box, key, value, group) {
		let line = box.lines[key];

		if (!line) {
			line = box.lines[key] = E('div', { 'class': 'o-ff-line' + (group ? ' o-ff-' + group : '') }, [
				E('b', {}, [ key + ':' ]), E('span', {}, [ '' ])
			]);

			box.info.insertBefore(line, box.end);
		}

		line.hidden = !value;
		line.setAttribute('data-full', value);
		line.lastChild.textContent = value;
	},

	theme(id) {
		if (this.ff)
			this.put(this.ff, 'Theme', id);
	},

	/* What the stock widget does not show comes from the readings of the bar. */
	readings(info) {
		if (!this.ff)
			return;

		const mem = info.memory;
		const avail = (mem.available != null) ? mem.available : ((mem.free || 0) + (mem.buffered || 0));

		this.put(this.ff, 'Memory', amount(mem.total - avail, mem.total));

		if (L.isObject(info.root) && info.root.total)
			this.put(this.ff, 'Disk', amount(info.root.used * 1024, info.root.total * 1024));
	},

	/* Windows of this module the settings can switch off. */
	windows() {
		return [
			{ key: 'wan', title: _('Internet'), el: this.wan.win },
			{ key: 'devices', title: _('Devices'), el: this.devices.win }
		];
	},

	show(key, on) {
		this[key].win.hidden = !on;

		if (on)
			(key == 'wan') ? this.pollWan() : this.pollDevices();
	},

	speedBlock(direction) {
		const value = E('span', {}, [ '' ]);
		const peak = E('span', { 'class': 'o-sp-peak' }, [ '' ]);
		const graph = chart();

		return {
			value: value,
			peak: peak,
			graph: graph,
			top: 0,
			el: E('div', { 'class': 'o-sp o-sp-' + direction }, [
				E('div', { 'class': 'o-sp-row' }, [ icon(direction), value, peak ]),
				E('div', { 'class': 'o-spark', 'aria-hidden': 'true' }, [ graph.svg ])
			])
		};
	},

	buildWan() {
		const name = E('b', {}, [ 'wan' ]);
		const state = E('span', { 'class': 'o-wan-state' }, [ '' ]);
		const sep = E('div', { 'class': 'o-ff-sep', 'aria-hidden': 'true' }, [ '---' ]);
		const down = this.speedBlock('down');
		const up = this.speedBlock('up');
		const speed = E('div', { 'class': 'o-speeds', 'hidden': '' }, [ down.el, up.el ]);
		const facts = E('div', { 'class': 'o-wan-facts' });
		const info = E('div', { 'class': 'o-ff-info' }, [
			E('div', { 'class': 'o-ff-title o-wan-title' }, [ name, state ]),
			sep,
			E('div', { 'class': 'o-wan-body' }, [ facts, speed ])
		]);

		this.wan = {
			win: E('div', { 'class': 'cbi-section o-wan-win', 'hidden': (this.shown.wan === false) ? '' : null }, [
				E('div', { 'id': 'o-wan' }, [ info ])
			]),
			info: facts, end: null, lines: {},
			name: name, state: state, sep: sep, speed: speed, down: down, up: up
		};

		WAN.forEach(L.bind(function(entry) {
			this.put(this.wan, entry[0], '', entry[1]);
		}, this));
	},

	pollWan() {
		if (this.wan.win.hidden)
			return Promise.resolve();

		return Promise.all([
			network.getWANNetworks(),
			network.getWAN6Networks(),
			network.getNetwork('wan')
		]).then(L.bind(function(data) {
			const net = data[0][0] || data[1][0] || data[2];
			const dev = net ? (net.getL3Device() || net.getDevice()) : null;

			this.renderWan(net, data[1][0], dev);

			if (!dev || !net.isUp()) {
				this.wan.speed.hidden = true;
				return;
			}

			return L.resolveDefault(callRealtime('interface', dev.getName()), []).then(L.bind(function(samples) {
				this.renderSpeed(samples, dev.getName());
			}, this));
		}, this));
	},

	/* Online says that the connection is up and has a default route. This does not
	   ping anything: a router should not call out each time its page is opened. */
	renderWan(net, net6, dev) {
		const w = this.wan;
		const up = !!net && net.isUp();
		const speed = dev ? dev.getSpeed() : null;
		const title = (net ? net.getName() : 'wan') + (dev ? '@' + dev.getName() : '');
		const six = (net6 || net) ? (net6 || net).getIP6Addrs() : [];
		const online = up && !!(net.getGatewayAddr() || (net6 && net6.getGateway6Addr()));

		w.name.textContent = title;
		w.sep.textContent = '-'.repeat(title.length);
		w.state.textContent = '\u25cf ' + (!net ? _('No WAN') : (!up ? _('Offline') : (online ? _('Online') : _('No route'))));
		w.state.className = 'o-wan-state ' + (online ? 'on' : 'off');

		this.put(w, 'Proto', net ? net.getI18n() : '');
		this.put(w, 'IPv4', up ? (net.getIPAddrs()[0] || '') : '');
		this.put(w, 'IPv6', up ? (six[0] || '') : '');
		this.put(w, 'Gateway', up ? (net.getGatewayAddr() || '') : '');
		this.put(w, 'DNS', up ? net.getDNSAddrs().join(', ') : '');
		this.put(w, 'Link', (up && speed > 0) ? '%d Mbit/s'.format(speed) : '');
		this.put(w, 'Uptime', up ? '%t'.format(net.getUptime()) : '');
	},

	/* The last minute the router has counted, and the best seen while this
	   page is open. Without the counting service the speeds stay away. */
	renderSpeed(samples, name) {
		const w = this.wan;

		w.speed.hidden = (samples.length < 2);

		if (w.speed.hidden)
			return;

		if (w.device != name) {
			w.device = name;
			w.down.top = w.up.top = 0;
		}

		[ [ w.down, 1 ], [ w.up, 3 ] ].forEach(function(entry) {
			const block = entry[0];
			const values = rates(samples, entry[1]);
			const recent = values.slice(-3);

			block.top = Math.max.apply(null, values.concat(block.top));
			block.value.textContent = rate(recent.reduce(function(a, b) { return a + b }, 0) / recent.length);
			block.peak.textContent = _('peak') + ' ' + rate(block.top);
			plot(block.graph, values);
		});
	},

	buildDevices() {
		const heading = E('h3', {}, [ _('Devices') ]);
		const table = E('table', { 'class': 'table' });

		this.devices = {
			win: E('div', {
				'class': 'cbi-section',
				'id': 'o-devices',
				'hidden': (this.shown.devices === false) ? '' : null
			}, [ E('div', { 'class': 'cbi-title' }, [ heading ]), E('div', {}, [ table ]) ]),
			heading: heading,
			table: table
		};
	},

	/* Who is on the Wi-Fi of this router right now. */
	stations() {
		return network.getWifiNetworks().then(function(nets) {
			return Promise.all(nets.map(function(net) {
				return L.resolveDefault(net.getAssocList(), []).then(function(list) {
					return list.map(function(sta) {
						return { mac: sta.mac.toUpperCase(), signal: sta.signal, ssid: net.getActiveSSID() };
					});
				});
			}));
		}).then(function(lists) {
			return [].concat.apply([], lists);
		});
	},

	pollDevices() {
		if (this.devices.win.hidden)
			return Promise.resolve();

		return Promise.all([
			L.resolveDefault(fs.exec('/sbin/ip', [ '-4', 'neigh', 'show' ]), null),
			L.resolveDefault(callLeases(), {}),
			L.resolveDefault(callHints(), {}),
			L.resolveDefault(this.stations(), []),
			L.resolveDefault(network.getWANNetworks(), [])
		]).then(L.bind(function(data) {
			this.renderDevices(this.collect(data[0], data[1].dhcp_leases || [], data[2], data[3], data[4]));
		}, this));
	},

	/* A device counts as connected while the neighbour table or the Wi-Fi knows it,
	   not for as long as its lease lasts. Who may not read that table gets the
	   leases. Leases and hints only put names to the others. */
	collect(neighbours, leases, hints, stations, wans) {
		const hosts = {};
		const skip = {};
		const entry = function(mac) {
			return hosts[mac] = hosts[mac] || { mac: mac };
		};

		wans.forEach(function(net) {
			const dev = net.getL3Device() || net.getDevice();

			if (dev)
				skip[dev.getName()] = true;
		});

		if (neighbours)
			(neighbours.stdout || '').split('\n').forEach(function(line) {
				const words = line.trim().split(' ');
				const lladdr = words.indexOf('lladdr');
				const state = words[words.length - 1];

				if (lladdr < 0 || !words[lladdr + 1] || skip[words[words.indexOf('dev') + 1]] || state == 'FAILED' || state == 'NOARP')
					return;

				const host = entry(words[lladdr + 1].toUpperCase());

				host.ip = words[0];
				host.online = host.online || (state != 'STALE');
			});

		stations.forEach(function(sta) {
			const host = entry(sta.mac);

			host.wifi = sta;
			host.online = true;
		});

		leases.forEach(function(lease) {
			const mac = (lease.macaddr || '').toUpperCase();

			if (mac && !neighbours)
				entry(mac);

			if (hosts[mac]) {
				hosts[mac].name = lease.hostname;
				hosts[mac].ip = hosts[mac].ip || lease.ipaddr;
				hosts[mac].expires = lease.expires;
			}
		});

		Object.keys(hints).forEach(function(mac) {
			const host = hosts[mac.toUpperCase()];

			if (host) {
				host.name = host.name || hints[mac].name;
				host.ip = host.ip || (hints[mac].ipaddrs || [])[0];
			}
		});

		return Object.keys(hosts).map(function(mac) { return hosts[mac] }).sort(function(a, b) {
			return addressValue(a) - addressValue(b);
		});
	},

	renderDevices(list) {
		const titles = [ _('Hostname'), _('IPv4 address'), _('MAC address'), _('Connection'), _('Remaining time') ];
		const head = E('tr', { 'class': 'tr table-titles' }, titles.map(function(title) {
			return E('th', { 'class': 'th' }, [ title ]);
		}));

		const rows = list.map(function(host) {
			const lease = (host.expires === false) ? _('unlimited') : ((host.expires > 0) ? '%t'.format(host.expires) : '-');
			const link = host.wifi ? 'Wi-Fi %s (%d dBm)'.format(host.wifi.ssid || '?', host.wifi.signal) : 'LAN';
			const cells = [
				E('span', {
					'class': 'o-dev-name' + (host.online ? ' on' : ''),
					'title': host.online ? _('Active') : _('Idle')
				}, [ icon(kindOf(host)), E('span', {}, [ host.name || '?' ]) ]),
				host.ip || '?', host.mac, link, lease
			];

			return E('tr', { 'class': 'tr' }, cells.map(function(cell, i) {
				return E('td', { 'class': 'td', 'data-title': titles[i] }, [ cell ]);
			}));
		});

		if (!rows.length)
			rows.push(E('tr', { 'class': 'tr placeholder' }, [
				E('td', { 'class': 'td' }, [ E('em', {}, [ _('No devices connected') ]) ])
			]));

		this.devices.heading.textContent = list.length ? '%s (%d)'.format(_('Devices'), list.length) : _('Devices');
		dom.content(this.devices.table, [ head ].concat(rows));
	}
});
