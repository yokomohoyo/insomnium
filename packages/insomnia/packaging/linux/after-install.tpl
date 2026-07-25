#!/bin/bash

# NOTE: electron-builder's `deb.afterInstall` REPLACES its built-in
# after-install.tpl rather than appending to it. Everything above the
# "APT repository registration" block below is a verbatim copy of
# app-builder-lib/templates/linux/after-install.tpl — keep it in sync when
# bumping electron-builder, or the alternatives/AppArmor wiring silently
# disappears from the package.

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse#Dumping_profiles
#
# Unfortunately, at the moment AppArmor doesn't have a good story for backwards compatibility.
# https://askubuntu.com/questions/1517272/writing-a-backwards-compatible-apparmor-profile
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      # https://wiki.debian.org/AppArmor/Contribute/FirstTimeProfileImport
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

# ~~~~~~~~~~~~~~~~~~~~~~~~~~ #
# APT repository registration #
# ~~~~~~~~~~~~~~~~~~~~~~~~~~ #
# Without this the package installs fine but apt has no upstream to check, so
# `apt upgrade` never offers a new version. Registering the repo here is the
# same approach Chrome and VS Code take.

APT_KEYRING_SOURCE='/opt/${sanitizedProductName}/resources/insomnium-archive-keyring.gpg'
APT_KEYRING_TARGET='/usr/share/keyrings/insomnium-archive-keyring.gpg'
APT_SOURCE_FILE='/etc/apt/sources.list.d/insomnium.list'
APT_SOURCE_URL='https://yokomohoyo.github.io/insomnium/apt'

# Respect the opt-out used by Chrome/VS Code so unattended images can skip this.
if [ "${INSOMNIUM_SKIP_APT_SOURCE:-0}" != "1" ] && [ -f "$APT_KEYRING_SOURCE" ] && [ -d /etc/apt/sources.list.d ]; then
  install -D -m 0644 "$APT_KEYRING_SOURCE" "$APT_KEYRING_TARGET" || true

  # dpkg treats a conffile the admin edited as sacred; only write when absent or
  # when we previously wrote it, so a hand-tuned source is never clobbered.
  if [ ! -e "$APT_SOURCE_FILE" ] || grep -q 'added by the insomnium package' "$APT_SOURCE_FILE" 2>/dev/null; then
    cat > "$APT_SOURCE_FILE" <<EOF
# This file was added by the insomnium package.
# Remove or comment the line below to stop receiving Insomnium updates via apt.
deb [arch=amd64 signed-by=$APT_KEYRING_TARGET] $APT_SOURCE_URL stable main
EOF
    chmod 0644 "$APT_SOURCE_FILE" || true
  fi
fi
