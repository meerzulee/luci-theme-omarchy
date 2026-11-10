#
# luci-theme-omarchy
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-omarchy
# luci.mk takes LUCI_NAME from the name of the directory. Pinned, so that a
# checkout under another name still builds this package.
LUCI_NAME:=luci-theme-omarchy

# Raise the version with every change to the files under htdocs/: luci.mk puts
# it behind the stylesheet links as "?v=", which is what makes a browser fetch
# the new files.
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

LUCI_TITLE:=Omarchy Theme
LUCI_DESCRIPTION:=LuCI drawn as an Omarchy desktop: a bar with workspaces, framed panels, \
	a keyboard launcher and the Omarchy colour palettes. Unofficial. Written for \
	OpenWrt 25.12 and not tested on older releases.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

# luci.mk would otherwise name the LuCI project as home and maintainer.
LUCI_URL:=https://github.com/meerzulee/luci-theme-omarchy
LUCI_MAINTAINER:=Meerzulee <17146298+meerzulee@users.noreply.github.com>

# csstidy predates :has() and custom properties and drops rules that use them.
# The stylesheets ship as written.
LUCI_MINIFY_CSS:=0

# The base stylesheets and the templates come from luci-theme-bootstrap
# (Apache-2.0), the palette colours from Omarchy (MIT), the icon font from Nerd
# Fonts (MIT) with glyphs of Material Design Icons (Apache-2.0), the ASCII logo
# of the home screen from fastfetch (MIT). See README.md.
PKG_LICENSE:=Apache-2.0 MIT
PKG_LICENSE_FILES:=LICENSE LICENSE.omarchy LICENSE.nerd-fonts LICENSE.fastfetch

# luci.mk copies only htdocs/, root/ and ucode/ into the build directory, which
# is where PKG_LICENSE_FILES is looked up.
define Build/Prepare/luci-theme-omarchy
	$(CP) $(CURDIR)/LICENSE $(CURDIR)/LICENSE.omarchy $(CURDIR)/LICENSE.nerd-fonts $(CURDIR)/LICENSE.fastfetch $(PKG_BUILD_DIR)/
endef

# The theme brings no rpcd plugin and no ACL, so the "rpcd reload" in luci.mk's
# own postinst has nothing to pick up. The theme is registered by
# /etc/uci-defaults/30_luci-theme-omarchy, which the package manager runs.
define Package/luci-theme-omarchy/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
}
exit 0
endef

define Package/luci-theme-omarchy/postrm
#!/bin/sh
# opkg also runs this for the old version during an upgrade, apk does not.
case "$$1" in *upgrade*) exit 0 ;; esac
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q show luci.themes | while IFS='=' read -r key value; do
		case "$$key" in
			luci.themes.Omarchy*) uci -q delete "$$key" ;;
		esac
	done
	# Do not leave LuCI pointing at files that are gone.
	case "$$(uci -q get luci.main.mediaurlbase)" in
		/luci-static/omarchy|/luci-static/omarchy-*)
			if [ -f /usr/share/ucode/luci/template/themes/bootstrap/header.ut ]; then
				uci set luci.main.mediaurlbase=/luci-static/bootstrap
			else
				next="$$(uci -q show luci.themes | sed -n "s/^luci\.themes\.[^=]*='\(.*\)'$$/\1/p" | head -n 1)"
				[ -z "$$next" ] || uci set luci.main.mediaurlbase="$$next"
			fi ;;
	esac
	uci commit luci
}
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# The build system finds packages by searching the Makefiles for the text below,
# so this line has to stay although luci.mk makes the call.
# call BuildPackage - OpenWrt buildroot signature
