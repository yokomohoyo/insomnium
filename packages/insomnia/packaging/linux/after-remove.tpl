#!/bin/bash

# NOTE: electron-builder's `deb.afterRemove` REPLACES its built-in
# after-remove.tpl. Everything above the "APT repository cleanup" block is a
# verbatim copy of app-builder-lib/templates/linux/after-remove.tpl — keep it
# in sync when bumping electron-builder.

# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi

# ~~~~~~~~~~~~~~~~~~~~ #
# APT repository cleanup #
# ~~~~~~~~~~~~~~~~~~~~ #
# Only on purge. On a plain `apt remove` the source list is left in place so a
# later reinstall still sees the repo, matching Chrome's behaviour.

if [ "$1" = "purge" ]; then
  rm -f '/etc/apt/sources.list.d/insomnium.list'
  rm -f '/usr/share/keyrings/insomnium-archive-keyring.gpg'
fi
