#!/bin/bash
# Install the "Claude Usage Bar" applet for the current user.
#
#   ./install.sh            link the applet from this folder (default, easy to update)
#   ./install.sh --copy     copy the files, so this folder can be deleted afterwards
#   ./install.sh --uninstall  remove the applet from ~/.local/share/cinnamon/applets
set -e

UUID="claude-usage@mwxxhdb"
SRC="$(cd "$(dirname "$0")" && pwd)/$UUID"
DEST_DIR="$HOME/.local/share/cinnamon/applets"
DEST="$DEST_DIR/$UUID"
MODE="link"

for arg in "$@"; do
    case "$arg" in
        --copy) MODE="copy" ;;
        --link) MODE="link" ;;
        --uninstall) MODE="uninstall" ;;
        -h|--help)
            sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown option: $arg (try --help)" >&2
            exit 1
            ;;
    esac
done

if [ "$MODE" = "uninstall" ]; then
    rm -rf "$DEST"
    echo "Removed: $DEST"
    echo "Now remove the applet from your panel: right click the panel -> Applets."
    exit 0
fi

# --- checks -------------------------------------------------------------
if ! command -v cinnamon >/dev/null 2>&1; then
    echo "Warning: Cinnamon was not found. This applet only works on the Cinnamon desktop" >&2
    echo "         (Linux Mint Cinnamon edition)." >&2
fi

# The applet runs the command in a bash login shell, so check it the same way.
if ! /bin/bash -lc 'command -v claude >/dev/null 2>&1'; then
    echo "Warning: the 'claude' command was not found in a login shell." >&2
    echo "         Install Claude Code first, or set the full path to 'claude' in the" >&2
    echo "         applet settings (for example: /home/$USER/.local/bin/claude -p /usage)." >&2
fi

if [ ! -f "$SRC/metadata.json" ]; then
    echo "Error: $SRC/metadata.json not found. Run this script from inside the repository." >&2
    exit 1
fi

# --- install ------------------------------------------------------------
mkdir -p "$DEST_DIR"

if [ "$MODE" = "copy" ]; then
    rm -rf "$DEST"
    cp -r "$SRC" "$DEST"
    echo "Installed (copy): $DEST"
else
    ln -sfn "$SRC" "$DEST"
    echo "Installed (symlink): $DEST -> $SRC"
    echo "Keep this folder in place; 'git pull' is enough to update the applet."
fi

echo ""
echo "Next steps:"
echo "  1. Right click the panel -> Applets -> find 'Claude Usage Bar' -> add it to the panel."
echo "  2. Right click the applet -> Configure to change the refresh interval, width, etc."
echo ""
echo "After changing the code, reload Cinnamon with Alt+F2, type 'r' and press Enter."
