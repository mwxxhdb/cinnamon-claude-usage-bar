/**
 * Claude Usage Bar — Cinnamon panel applet
 *
 * Shows Claude Code usage as two horizontal progress bars:
 *   top    — current 5-hour session usage
 *   bottom — current week (all models) usage
 *
 * A vertical marker on each bar shows where "now" sits inside the
 * 5-hour / 7-day window. If usage is slightly ahead of the marker the
 * bar turns orange; far ahead it turns red.
 *
 * Data comes from parsing the output of `claude -p /usage`.
 */

const Applet = imports.ui.applet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;

const SESSION_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const COLOR_TRACK = [1, 1, 1, 0.22];
const COLOR_TRACK_ERROR = [0.9, 0.3, 0.3, 0.3];
const COLOR_OK = [0.30, 0.69, 0.31, 1];      // green
const COLOR_WARN = [1.00, 0.60, 0.00, 1];    // orange
const COLOR_DANGER = [0.92, 0.26, 0.21, 1];  // red
const COLOR_MARKER = [1, 1, 1, 0.9];

class ClaudeUsageApplet extends Applet.Applet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this.setAllowedLayout(Applet.AllowedLayout.HORIZONTAL);

        this._session = null;   // { pct, resetAt: Date|null }
        this._week = null;
        this._error = null;
        this._lastUpdate = null;
        this._refreshing = false;
        this._refreshTimerId = 0;
        this._repaintTimerId = 0;

        this.settings = new Settings.AppletSettings(this, metadata.uuid, instanceId);
        this.settings.bind('refresh-minutes', 'refreshMinutes', () => this._restartRefreshTimer());
        this.settings.bind('command', 'command', () => {});
        this.settings.bind('bar-width', 'barWidth', () => this._applyWidth());
        this.settings.bind('danger-threshold', 'dangerThreshold', () => this._area.queue_repaint());
        this.settings.bind('workdays-per-week', 'workdaysPerWeek', () => this._area.queue_repaint());

        this._area = new St.DrawingArea();
        this._applyWidth();
        this._area.connect('repaint', (area) => this._onRepaint(area));
        this.actor.add(this._area, { y_fill: true, y_align: St.Align.MIDDLE });

        this.set_applet_tooltip('Claude Usage: loading…');

        this._restartRefreshTimer();
        // repaint every minute so the time marker keeps moving between refreshes
        this._repaintTimerId = Mainloop.timeout_add_seconds(60, () => {
            this._area.queue_repaint();
            return true;
        });
        this._refresh();
    }

    on_applet_clicked() {
        this._refresh();
    }

    on_applet_removed_from_panel() {
        if (this._refreshTimerId) Mainloop.source_remove(this._refreshTimerId);
        if (this._repaintTimerId) Mainloop.source_remove(this._repaintTimerId);
        this._refreshTimerId = 0;
        this._repaintTimerId = 0;
        this.settings.finalize();
    }

    _applyWidth() {
        this._area.set_width(Math.max(40, this.barWidth || 140));
    }

    _restartRefreshTimer() {
        if (this._refreshTimerId) Mainloop.source_remove(this._refreshTimerId);
        const minutes = Math.max(1, this.refreshMinutes || 5);
        this._refreshTimerId = Mainloop.timeout_add_seconds(minutes * 60, () => {
            this._refresh();
            return true;
        });
    }

    _refresh() {
        if (this._refreshing) return;
        this._refreshing = true;
        try {
            // bash login shell so PATH additions (~/.local/bin etc.) are picked up;
            // /bin/sh (dash) chokes on bash-only syntax in ~/.profile
            const proc = Gio.Subprocess.new(
                ['/bin/bash', '-lc', this.command || 'claude -p /usage'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                this._refreshing = false;
                try {
                    const [, stdout, stderr] = p.communicate_utf8_finish(res);
                    if (p.get_successful() && stdout && stdout.trim()) {
                        this._parseOutput(stdout);
                    } else {
                        const msg = (stderr || stdout || 'command failed').trim().split('\n')[0];
                        this._error = msg;
                    }
                } catch (e) {
                    this._error = String(e);
                }
                this._area.queue_repaint();
                this._updateTooltip();
            });
        } catch (e) {
            this._refreshing = false;
            this._error = String(e);
            this._area.queue_repaint();
            this._updateTooltip();
        }
    }

    _parseOutput(raw) {
        // strip ANSI escape sequences just in case
        const text = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
        const sm = text.match(/Current session:\s*(\d+)%\s*used(?:[^\n]*?resets\s*([^(\n]+))?/);
        const wm = text.match(/Current week \(all models\):\s*(\d+)%\s*used(?:[^\n]*?resets\s*([^(\n]+))?/);
        if (!sm && !wm) {
            this._error = 'could not parse usage from the command output';
            return;
        }
        this._session = sm
            ? { pct: parseInt(sm[1], 10), resetAt: this._parseResetTime(sm[2]) }
            : null;
        this._week = wm
            ? { pct: parseInt(wm[1], 10), resetAt: this._parseResetTime(wm[2]) }
            : null;
        this._error = null;
        this._lastUpdate = new Date();
    }

    /**
     * Parse reset times like "Jul 28, 1:40pm", "Aug 3, 9am" or "6pm".
     * The timezone name in parentheses is already stripped by the caller's
     * regex; times are assumed to be in the machine's local timezone.
     */
    _parseResetTime(str) {
        if (!str) return null;
        const now = new Date();
        let m = str.match(/([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        let year = now.getFullYear();
        let month, day, hour, minute;
        if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
            month = MONTHS[m[1].toLowerCase()];
            day = parseInt(m[2], 10);
            hour = parseInt(m[3], 10);
            minute = m[4] ? parseInt(m[4], 10) : 0;
            hour = this._to24h(hour, m[5]);
        } else {
            // time-only form, e.g. "resets 6pm"
            m = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
            if (!m) return null;
            month = now.getMonth();
            day = now.getDate();
            hour = this._to24h(parseInt(m[1], 10), m[3]);
            minute = m[2] ? parseInt(m[2], 10) : 0;
        }
        let d = new Date(year, month, day, hour, minute);
        // year rollover (e.g. now is late Dec, reset in early Jan)
        if (d.getTime() < now.getTime() - 12 * 3600 * 1000) {
            if (month === now.getMonth() && day === now.getDate()) {
                d = new Date(d.getTime() + 24 * 3600 * 1000); // time-only, tomorrow
            } else {
                d.setFullYear(year + 1);
            }
        }
        return d;
    }

    _to24h(hour, ampm) {
        if (!ampm) return hour;
        const pm = ampm.toLowerCase() === 'pm';
        if (pm && hour !== 12) return hour + 12;
        if (!pm && hour === 12) return 0;
        return hour;
    }

    /**
     * Position of "now" inside the window. The window always spans
     * periodMs (ending at resetAt), but the marker walks it in
     * effectiveMs — for the weekly bar effectiveMs is workdays × 24h,
     * so the marker reaches the end after the workdays are spent and
     * stays there through the rest of the week.
     */
    _timeFraction(data, periodMs, effectiveMs) {
        if (!data || !data.resetAt) return null;
        const start = data.resetAt.getTime() - periodMs;
        const frac = (Date.now() - start) / effectiveMs;
        return Math.min(1, Math.max(0, frac));
    }

    _onRepaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const padY = 3;
        const gap = 3;
        const barH = Math.max(3, (h - padY * 2 - gap) / 2);

        const workdays = Math.min(7, Math.max(1, this.workdaysPerWeek || 5));
        this._drawBar(cr, 0, padY, w, barH, this._session, SESSION_MS, SESSION_MS);
        this._drawBar(cr, 0, padY + barH + gap, w, barH, this._week, WEEK_MS, WEEK_MS * workdays / 7);

        cr.$dispose();
    }

    _drawBar(cr, x, y, w, h, data, periodMs, effectiveMs) {
        const r = Math.min(3, h / 2);
        const track = (this._error && !data) ? COLOR_TRACK_ERROR : COLOR_TRACK;
        cr.setSourceRGBA(track[0], track[1], track[2], track[3]);
        this._roundedRect(cr, x, y, w, h, r);
        cr.fill();

        if (!data) return;

        const frac = Math.min(1, Math.max(0, data.pct / 100));
        const timeFrac = this._timeFraction(data, periodMs, effectiveMs);

        let color = COLOR_OK;
        if (timeFrac !== null) {
            const over = frac - timeFrac;
            if (over > (this.dangerThreshold || 10) / 100) color = COLOR_DANGER;
            else if (over > 0) color = COLOR_WARN;
        }

        if (frac > 0) {
            cr.save();
            this._roundedRect(cr, x, y, w, h, r);
            cr.clip();
            cr.setSourceRGBA(color[0], color[1], color[2], color[3]);
            cr.rectangle(x, y, w * frac, h);
            cr.fill();
            cr.restore();
        }

        if (timeFrac !== null) {
            const mx = x + w * timeFrac;
            cr.setSourceRGBA(COLOR_MARKER[0], COLOR_MARKER[1], COLOR_MARKER[2], COLOR_MARKER[3]);
            cr.rectangle(Math.min(mx, x + w - 1.5) - 0.75, y - 1, 1.5, h + 2);
            cr.fill();
        }
    }

    _roundedRect(cr, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, h / 2, w / 2));
        cr.newSubPath();
        cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
        cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
        cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
        cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
        cr.closePath();
    }

    _fmtReset(d) {
        if (!d) return 'unknown';
        const pad = (n) => (n < 10 ? '0' + n : '' + n);
        return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    _updateTooltip() {
        const lines = ['Claude Code usage'];
        if (this._session) {
            lines.push(`5-hour session: ${this._session.pct}% (resets ${this._fmtReset(this._session.resetAt)})`);
        }
        if (this._week) {
            lines.push(`This week (all models): ${this._week.pct}% (resets ${this._fmtReset(this._week.resetAt)})`);
        }
        if (this._error) {
            lines.push(`Error: ${this._error}`);
        }
        if (this._lastUpdate) {
            const pad = (n) => (n < 10 ? '0' + n : '' + n);
            lines.push(`Updated at ${pad(this._lastUpdate.getHours())}:${pad(this._lastUpdate.getMinutes())} (click to refresh now)`);
        }
        this.set_applet_tooltip(lines.join('\n'));
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new ClaudeUsageApplet(metadata, orientation, panelHeight, instanceId);
}
