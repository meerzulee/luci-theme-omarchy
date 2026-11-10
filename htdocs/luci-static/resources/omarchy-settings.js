'use strict';
'require baseclass';

/*
 * The panel of luci-theme-omarchy that grows out of the bar: the list of themes,
 * and the settings for the wallpaper and for what is on the home screen. All of it stays in this browser: a wallpaper is far larger than
 * what a router has to spare.
 *
 * Licensed to the public under the Apache License 2.0.
 */

const LOOK = 'omarchy.look';
const WALL = 'omarchy.wall';
const OMARCHY = 'https://raw.githubusercontent.com/omacom/omarchy/v4.5.0/themes/';
const root = document.documentElement;

/* Tried in turn until the picture fits into local storage. The header reads it
   from there before the first paint, so pages do not flash the plain backdrop. */
const SIZES = [ [ 1920, .8 ], [ 1600, .7 ], [ 1280, .6 ], [ 960, .5 ] ];
const LIMIT = 1500000;
const BLUR = 8;

return baseclass.extend({
	__init__() {
		this.look = {};

		try {
			this.look = JSON.parse(localStorage.getItem(LOOK)) || {};
		}
		catch (e) {}
	},

	save() {
		try {
			localStorage.setItem(LOOK, JSON.stringify(this.look));
		}
		catch (e) {}
	},

	blurValue() {
		return (this.look.blur != null) ? +this.look.blur : BLUR;
	},

	/* A picture behind the windows, or without one the backdrop of the theme. */
	show(data, kind) {
		if (data) {
			root.style.setProperty('--o-wall', 'url("' + data + '")');
			root.style.setProperty('--o-wall-blur', this.blurValue() + 'px');
			root.setAttribute('data-o-wall', kind);
		}
		else {
			root.style.removeProperty('--o-wall');
			root.style.removeProperty('--o-wall-blur');
			root.removeAttribute('data-o-wall');
		}
	},

	say(text) {
		if (this.status)
			this.status.textContent = text;
	},

	/* Shrinks a picture until it fits, keeps it and puts it up. */
	store(blob, kind, id) {
		return createImageBitmap(blob).then(L.bind(function(img) {
			let data = null;

			for (let i = 0; i < SIZES.length && !data; i++) {
				const scale = Math.min(1, SIZES[i][0] / img.width);
				const canvas = document.createElement('canvas');

				canvas.width = Math.round(img.width * scale);
				canvas.height = Math.round(img.height * scale);
				canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

				const encoded = canvas.toDataURL('image/jpeg', SIZES[i][1]);

				if (encoded.length <= LIMIT)
					data = encoded;
			}

			if (!data)
				throw new Error('too large');

			localStorage.setItem(WALL, JSON.stringify({ kind: kind, id: id, data: data }));

			this.look.wall = kind;
			this.save();
			this.show(data, kind);
			this.mark();
			this.say('');
		}, this));
	},

	pick(ev) {
		const file = ev.target.files[0];

		ev.target.value = '';

		if (!file)
			return;

		this.say(_('Loading…'));

		this.store(file, 'image', null).catch(L.bind(function() {
			this.say(_('This picture cannot be used, or it does not fit into the browser storage.'));
		}, this));
	},

	/* A wallpaper Omarchy has for a theme. The package does not contain these:
	   the browser fetches one from GitHub when asked to, and keeps it. Without a
	   number it is the one chosen last, or the nearest a shorter list has. */
	loadOmarchy(id, index) {
		this.say(_('Downloading…'));

		return L.require('omarchy-palettes').then(L.bind(function(data) {
			const entry = data.list.filter(function(p) { return p.id == id })[0];
			const walls = entry ? entry.walls : [];

			if (!walls.length)
				throw new Error('no wallpaper');

			this.look.pick = Math.min((index != null) ? index : (this.look.pick || 0), walls.length - 1);

			return fetch(OMARCHY + encodeURIComponent(id) + '/backgrounds/' + encodeURIComponent(walls[this.look.pick]));
		}, this)).then(function(res) {
			if (!res.ok)
				throw new Error('HTTP ' + res.status);

			return res.blob();
		}).then(L.bind(function(blob) {
			return this.store(blob, 'omarchy', id);
		}, this)).catch(L.bind(function() {
			this.say(_('Could not download the wallpaper. This needs an internet connection in this browser.'));
		}, this));
	},

	current() {
		return root.getAttribute('data-palette') || root.getAttribute('data-served-palette');
	},

	useColours() {
		try {
			localStorage.removeItem(WALL);
		}
		catch (e) {}

		this.look.wall = 'colors';
		this.save();
		this.show(null);
		this.mark();
		this.say('');
	},

	setBlur() {
		this.look.blur = +this.blur.value;
		this.save();

		if (root.hasAttribute('data-o-wall'))
			root.style.setProperty('--o-wall-blur', this.look.blur + 'px');
	},

	/* The choices for the theme in use: its own colours, a button for every
	   wallpaper Omarchy has for it, and a picture of one's own. */
	fillWalls() {
		const entry = this.list.filter(L.bind(function(p) { return p.id == this.kept }, this))[0];
		const add = L.bind(function(key, label, title, click) {
			this.wallButtons[key] = this.wallRow.appendChild(E('button', {
				'type': 'button',
				'class': 'btn',
				'title': title,
				'click': click
			}, [ label ]));
		}, this);

		while (this.wallRow.firstChild)
			this.wallRow.removeChild(this.wallRow.firstChild);

		this.wallButtons = {};

		add('colors', _('Colours'), _('The colours of the theme, blurred'), L.bind(this.useColours, this));

		(entry ? entry.walls : []).forEach(L.bind(function(name, i) {
			add(i, String(i + 1), name.split('.')[0], L.bind(this.loadOmarchy, this, this.kept, i));
		}, this));

		add('image', _('Your image…'), _('A picture from this computer'), L.bind(function() { this.file.click() }, this));
	},

	/* Shows which choices are the current ones. */
	mark() {
		const wall = root.getAttribute('data-o-wall') || 'colors';

		/* a theme chosen elsewhere can change the wallpaper before this panel exists */
		if (!this.box)
			return;

		Object.keys(this.wallButtons).forEach(L.bind(function(key) {
			const on = (key == 'colors' || key == 'image') ? (key == wall) : (wall == 'omarchy' && +key == (this.look.pick || 0));

			this.wallButtons[key].setAttribute('aria-pressed', on ? 'true' : 'false');
		}, this));

		this.rows.forEach(L.bind(function(row) {
			row.setAttribute('aria-pressed', (row.getAttribute('data-id') == this.kept) ? 'true' : 'false');
		}, this));

		this.blurRow.hidden = (wall == 'colors');
	},

	/* The widgets of the status overview, switched with the switch of each,
	   so that the page itself stops fetching what is not shown. */
	listWidgets() {
		const dock = document.querySelector('#o-dock');
		const sections = document.querySelectorAll('#view .cbi-section:not(.cbi-section .cbi-section)');

		this.dockRow.hidden = !dock;

		if (dock)
			this.dockBox.checked = !dock.hidden;
		const rows = [];

		sections.forEach(function(section) {
			const label = section.querySelector(':scope > .cbi-title > h3 > .label');
			const body = section.querySelector(':scope > .cbi-title + div');

			/* LuCI keeps a widget hidden that has nothing to show on this router */
			if (label && body && section.style.display != 'none')
				rows.push(E('label', { 'class': 'o-set-check' }, [
					E('input', {
						'type': 'checkbox',
						'checked': label.classList.contains('notice') ? null : '',
						'change': function() { label.click() }
					}),
					label.parentNode.firstChild.data
				]));
		});

		/* the windows of the theme itself go right after the first one */
		if (this.menu.home)
			this.menu.home.windows().forEach(L.bind(function(win, i) {
				rows.splice(1 + i, 0, E('label', { 'class': 'o-set-check' }, [
					E('input', {
						'type': 'checkbox',
						'checked': win.el.hidden ? null : '',
						'change': L.bind(function(ev) {
							this.look.home = this.look.home || {};
							this.look.home[win.key] = ev.target.checked;
							this.save();
							this.menu.home.show(win.key, ev.target.checked);
						}, this)
					}),
					win.title
				]));
			}, this));

		this.widgets.hidden = (rows.length == 0);

		while (this.widgetRows.firstChild)
			this.widgetRows.removeChild(this.widgetRows.firstChild);

		rows.forEach(L.bind(function(row) { this.widgetRows.appendChild(row) }, this));
	},

	/* Leaves no preview of a theme behind. */
	close() {
		this.box.hidden = true;
		this.menu.paint(this.kept);
	},

	build(menu) {
		return L.require('omarchy-palettes').then(L.bind(function(data) {
			this.menu = menu;
			this.list = data.list;
			this.wallButtons = {};
			this.wallRow = E('div', { 'class': 'o-set-row' });
			this.status = E('p', { 'class': 'o-set-status', 'role': 'status' });
			this.file = E('input', { 'type': 'file', 'accept': 'image/*', 'hidden': '', 'change': L.bind(this.pick, this) });
			this.blur = E('input', {
				'type': 'range', 'min': '0', 'max': '40', 'step': '2',
				'value': this.blurValue(),
				'aria-label': _('Blur'),
				'input': L.bind(this.setBlur, this)
			});
			this.blurRow = E('label', { 'class': 'o-set-range' }, [ _('Blur'), this.blur ]);
			this.widgetRows = E('div');
			this.widgets = E('div', {}, [ E('h4', {}, [ _('Home screen') ]), this.widgetRows ]);
			this.dockBox = E('input', {
				'type': 'checkbox',
				'change': L.bind(function(ev) {
					document.querySelector('#o-dock').hidden = !ev.target.checked;
					this.look.dock = ev.target.checked;
					this.save();
				}, this)
			});
			this.dockRow = E('div', {}, [
				E('h4', {}, [ _('Status line') ]),
				E('label', { 'class': 'o-set-check' }, [ this.dockBox, _('Dock') ])
			]);

			/* pointing at a theme tries it on, choosing it keeps it */
			this.rows = data.list.map(L.bind(function(p) {
				return E('button', {
					'type': 'button',
					'class': 'o-set-theme',
					'data-id': p.id,
					'mouseenter': function() { menu.paint(p.id) },
					'click': L.bind(function() {
						this.kept = p.id;
						menu.keep(p.id);
						this.close();
					}, this)
				}, [
					E('span', {
						'class': 'o-swatch',
						'style': 'background:%s;color:%s;border-color:%s'.format(p.bg, p.fg, p.accent)
					}, [ 'Aa' ]),
					E('span', { 'class': 'o-set-name' }, [ p.name ]),
					E('em', {}, [ p.mode ])
				]);
			}, this));

			this.themes = E('div', {}, [
				E('h4', {}, [ _('Theme') ]),
				E('div', {
					'class': 'o-set-themes',
					'mouseleave': L.bind(function() { menu.paint(this.kept) }, this)
				}, this.rows)
			]);

			this.settings = E('div', {}, [
				E('h4', {}, [ _('Wallpaper') ]),
				this.wallRow,
				this.file,
				this.blurRow,
				this.status,
				this.widgets,
				this.dockRow
			]);

			this.box = E('div', { 'id': 'o-settings', 'role': 'dialog', 'hidden': '' }, [ this.themes, this.settings ]);

			document.body.appendChild(this.box);

			document.addEventListener('mousedown', L.bind(function(ev) {
				if (!this.box.hidden && !this.box.contains(ev.target) && !ev.target.closest('.o-gear, .o-theme-btn'))
					this.close();
			}, this));

			document.addEventListener('keydown', L.bind(function(ev) {
				if (ev.key == 'Escape' && !this.box.hidden)
					this.close();
			}, this));
		}, this));
	},

	/* Opens the list of themes ('theme') or the rest of the settings. The button
	   of the part that is open closes it, the other one switches over to its part. */
	toggle(menu, part) {
		const ready = this.box ? Promise.resolve() : this.build(menu);

		return ready.then(L.bind(function() {
			if (this.box.hidden)
				this.kept = this.current();
			else if (this.part == part)
				return this.close();

			this.part = part;
			this.themes.hidden = (part != 'theme');
			this.settings.hidden = (part == 'theme');
			this.box.setAttribute('aria-label', (part == 'theme') ? _('Theme') : _('Settings'));

			this.fillWalls();
			this.mark();
			this.listWidgets();
			this.box.hidden = false;
		}, this));
	}
});
