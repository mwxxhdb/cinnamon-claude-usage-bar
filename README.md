# Claude Usage Bar

**English** | [简体中文](README.zh-CN.md)

A Linux Mint (Cinnamon) panel applet that shows your Claude Code usage as two horizontal bars:

- **Top bar** — usage of the current 5-hour session window
- **Bottom bar** — usage of the current week (all models)

![The applet sitting in the Cinnamon panel](docs/images/panel.png)

Each bar has a white vertical marker showing where "now" sits inside the 5-hour / weekly window, so you can see whether you are spending faster than time passes:

- **Green** — usage is behind the marker, your pace is safe
- **Orange** — usage is slightly ahead of the marker, you may run out before the reset
- **Red** — usage is far ahead of the marker (more than 10 points by default, configurable), you will probably run out early

The data comes from running `claude -p /usage` on a timer and parsing its output.

## Requirements

- Linux Mint with the **Cinnamon** desktop (tested on Mint 22.1 / Cinnamon 6.4)
- [Claude Code](https://claude.com/claude-code) installed and logged in, so that `claude -p /usage` prints your usage
- `git` (only to clone this repository)

Check that the data source works before installing:

```bash
claude -p /usage
```

The output should contain lines like `Current session: 12% used` and `Current week (all models): 30% used`.

## Install

```bash
git clone https://github.com/mwxxhdb/cinnamon-claude-usage-bar.git claude-usage-bar
cd claude-usage-bar
./install.sh
```

Then enable it: **right click the panel → Applets → find "Claude Usage Bar" → add it to the panel.**

`install.sh` symlinks the applet into `~/.local/share/cinnamon/applets/`, so keep the cloned folder where it is and `git pull` is enough to update. Options:

| Command | What it does |
|---|---|
| `./install.sh` | Symlink the applet (default) |
| `./install.sh --copy` | Copy the files, so the cloned folder can be deleted afterwards |
| `./install.sh --uninstall` | Remove the applet from `~/.local/share/cinnamon/applets/` |

### Manual install (without the script)

```bash
mkdir -p ~/.local/share/cinnamon/applets
cp -r 'claude-usage@mwxxhdb' ~/.local/share/cinnamon/applets/
```

Then add it from the panel's Applets dialog as above. If the applet does not show up in the list, reload Cinnamon: press **Alt+F2**, type `r` and press Enter.

## Settings

Right click the applet → **Configure**:

![The applet settings dialog](docs/images/settings.png)

| Setting | Default | Description |
|---|---|---|
| Refresh interval | 5 minutes | How often `claude -p /usage` runs |
| Command used to read the usage | `claude -p /usage` | Change it if `claude` is not on your `PATH` (use an absolute path) |
| Bar width | 140 px | Width of the applet in the panel |
| Workdays per week | 5 days | The weekly time marker walks the whole bar in this many days (see below) |
| Danger threshold | 10 points | How far ahead of the marker the usage must be before the bar turns from orange to red |

### Workdays per week

The weekly quota always resets after 7 days, but if you only work 5 days a week a marker that moves evenly over 7 days makes it look like you are always ahead of schedule. This setting splits the window into N slices of 24 hours: the marker reaches the end of the bar N×24 hours after the window started, and stays there for the rest of the week (your weekend). Default is 5.

## Usage

- **Hover** — tooltip with the details (percentages, reset times, last update time)
- **Left click** — refresh immediately
- The marker position updates every minute, without waiting for the next refresh

## Notes and troubleshooting

- Reset times are parsed in your local timezone (the timezone name in the `/usage` output is ignored).
- Every refresh really runs `claude -p /usage`, so do not set the refresh interval too low.
- The command runs in a **bash login shell** (`/bin/bash -lc`), so `PATH` additions from `~/.profile` or `~/.bashrc` are picked up. If the bars stay empty and the tooltip shows an error, run the same command in a terminal, or put the absolute path to `claude` in the settings.
- Applet load errors show up in the system log:

  ```bash
  journalctl --user -n 100 | grep -i 'JS ERROR'
  ```

- After changing the code, reload Cinnamon with **Alt+F2 → `r` → Enter**, or remove and re-add the applet.

## Uninstall

```bash
./install.sh --uninstall
```

Also remove the applet from the panel (right click the panel → Applets) and, if you want, delete its settings:

```bash
rm -rf ~/.config/cinnamon/spices/claude-usage@mwxxhdb
```
