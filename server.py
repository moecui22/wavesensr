#!/usr/bin/env python3
"""WaveSensr - local browser app that streams and records Wi-Fi CSI from ESP32 boards.

    /usr/bin/python3 server.py        # open http://localhost:8777
    /usr/bin/python3 server.py --source serial --port /dev/tty.usbmodem1101

Sources
    serial    ESP32-S3/C6 running esp-csi, printing CSI_DATA lines
    udp       JSON list or raw int8 blob of interleaved [imag, real] pairs

Recordings: <save folder>/WS_<yyyymmdd>_<hhmmss>.csv (unix_time, s1..sN strength
per slice, s1 = lowest frequency) plus a .json sidecar with the details.
Stdlib only.
"""
import argparse, json, math, os, queue, re, socket, sqlite3, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
DATA = os.path.join(HERE, "data")
DB_PATH = os.path.join(DATA, "vitals.db")
SETTINGS = os.path.join(DATA, "settings.json")


def settings():
    try:
        return json.load(open(SETTINGS))
    except Exception:
        return {}


def save_dir():
    """Where recordings are written: the folder chosen in Setup, else data/.

    A chosen folder that has gone missing (an unplugged drive) falls back to
    data/ so a recording is never lost; /api/settings reports which one is live.
    """
    d = settings().get("save_dir")
    return d if d and os.path.isdir(d) else DATA


def _amps(ints):
    """esp-csi ships interleaved [imag, real] int8 pairs -> amplitudes."""
    return [math.hypot(ints[k + 1], ints[k]) for k in range(0, len(ints) - 1, 2)]


def _num3(x):
    """3 decimals, trailing zeros trimmed: 21.54069 -> 21.541, 0.0 -> 0."""
    return ("%.3f" % x).rstrip("0").rstrip(".")


def _freq_order(a):
    """Put slices in frequency order, lowest first.

    esp-csi stores each training field as positive subcarriers then negative
    (0..63, -64..-1 on HT40; 0..31, -32..-1 on 20 MHz), so the lower half of the
    channel sits in the second half of the list. Rotating by half fixes it, and
    s1 becomes the lowest frequency in the stream, the traces and the CSV.
    """
    h = len(a) // 2
    return a[h:] + a[:h] if len(a) in (64, 128) else a


def _ht_only(a):
    """Drop the legacy L-LTF block, the first 64 values of every esp-csi packet.

    Per ESP-IDF's CSI layout, L-LTF always comes first; on HT packets the HT-LTF
    after it re-measures the same frequencies (the firmware even averages the
    two, ltf_merge_en), so L-LTF is ~1/3 of the file with no new information.
    Non-HT packets carry only L-LTF (64 values) and are kept whole.
    """
    return a[64:] if len(a) > 64 else a


_num = re.compile(r"-?\d+")


def _ports():
    """Serial devices that could be the receiver, on either platform."""
    if os.name == "nt":
        try:
            from serial.tools.list_ports import comports
            return sorted(p.device for p in comports())
        except Exception:
            return ["COM%d" % i for i in range(1, 21)]
    import glob
    return sorted(glob.glob("/dev/tty.usbmodem*") + glob.glob("/dev/tty.wchusbserial*")
                  + glob.glob("/dev/tty.SLAB*") + glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*"))


def _next_port(port):
    cands = _ports()
    if not cands:
        return port
    return cands[(cands.index(port) + 1) % len(cands)] if port in cands else cands[0]


def _plain_serial(dev):
    """A USB board without pyserial: the device is just a file.

    Baud means nothing over USB CDC, so the only trick is opening /dev/cu.* rather
    than /dev/tty.*, which would block waiting for a carrier that never comes. Reset
    by RTS is not available this way, so it is a no-op; a stalled board needs a replug.
    """
    import select
    f = open(dev.replace("/dev/tty.", "/dev/cu."), "rb", buffering=0)
    buf = bytearray()

    class Plain:
        def readline(self):
            while b"\n" not in buf:
                if not select.select([f], [], [], 1.0)[0]:
                    return b""                   # quiet second: let the caller check for stop
                chunk = f.read(4096)
                if not chunk:
                    raise OSError("receiver closed")
                buf.extend(chunk)
            i = buf.index(b"\n")
            line = bytes(buf[:i + 1]); del buf[:i + 1]
            return line
        def setDTR(self, _): pass
        def setRTS(self, _): pass
        def close(self): f.close()
    return Plain()


def src_serial(cfg, stop):
    """Serial CSI with two recoveries, so a recording survives a bad cable.

    stall  - port open, board alive, no CSI for 5 s: pulse RTS to reset it
    drop   - device vanishes (USB wiggle): wait for it to re-enumerate,
             reopen, and carry on; the session gets a gap, not an ending
    """
    try:
        import serial
        opn = lambda dev: serial.Serial(dev, cfg["baud"], timeout=1)
    except ImportError:
        opn = _plain_serial                          # no pyserial: read the device as a file
    port = cfg["port"]
    while not stop.is_set():
        try:
            s = opn(port)
        except Exception:
            port = _next_port(port)                  # a replug moves the node name; Windows numbers COM ports
            STATE["link"] = "waiting for the receiver"
            time.sleep(1.0)
            continue
        STATE["link"] = "ok"
        opened = time.time()
        last_csi, last_kick = opened, 0.0
        quiet = False
        try:
            while not stop.is_set():
                raw = s.readline()
                now = time.time()
                if raw:
                    line = raw.decode("utf-8", "ignore")
                    if "CSI_DATA" in line and "[" in line:
                        a = _freq_order(_ht_only(_amps([int(x) for x in _num.findall(line[line.index("["):])])))
                        if len(a) >= 8:
                            if STATE.get("link") != "ok":
                                STATE["link"] = "ok"
                            last_csi = now
                            yield a
                            continue
                if last_csi == opened and now - opened > 8.0:
                    quiet = True                     # opened fine but says nothing: some other device
                    break
                if now - last_csi > 5.0 and now - last_kick > 15.0:
                    last_kick = now
                    STATE["link"] = "stalled, resetting the receiver"
                    s.setDTR(False); s.setRTS(True); time.sleep(0.1); s.setRTS(False)
        except Exception as e:
            # Any I/O failure on a hardware link means close, wait, reopen.
            # pyserial surfaces a vanished USB device as SerialException,
            # OSError or ValueError depending on where it trips; all of them
            # used to escape and kill the capture. GeneratorExit is not an
            # Exception, so stopping still works.
            STATE["link"] = "receiver lost (%s), reconnecting" % type(e).__name__
            time.sleep(0.5)
        finally:
            try:
                s.close()
            except Exception:
                pass
        if quiet:
            nxt = _next_port(port)
            STATE["link"] = "no CSI on %s" % port if nxt == port else "nothing on %s, trying %s" % (port, nxt)
            port = nxt
            time.sleep(0.5)


def src_udp(cfg, stop):
    host, _, port = cfg["bind"].partition(":")
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(1.0)
    s.bind((host, int(port)))
    try:
        while not stop.is_set():
            try:
                pkt, _ = s.recvfrom(8192)
            except socket.timeout:
                continue
            try:
                a = _amps(json.loads(pkt.decode()))
            except Exception:
                a = _amps([v - 256 if v > 127 else v for v in pkt])
            if len(a) >= 8:
                yield a
    finally:
        s.close()


SOURCES = {"serial": src_serial, "udp": src_udp}


# ------------------------------------------------------------------ storage
SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT, note TEXT,
  started REAL, ended REAL,
  source TEXT, engine TEXT, simulated INTEGER,
  subcarriers INTEGER, fs REAL, raw_file TEXT, distance_cm REAL);
"""


def db():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def db_init():
    os.makedirs(DATA, exist_ok=True)
    c = db()
    c.executescript(SCHEMA)
    if "distance_cm" not in [r[1] for r in c.execute("PRAGMA table_info(sessions)")]:
        c.execute("ALTER TABLE sessions ADD COLUMN distance_cm REAL")
    # a session left open by a hard kill: close it when its file was last written
    for r in c.execute("SELECT id, started, raw_file FROM sessions WHERE ended IS NULL").fetchall():
        f = r["raw_file"]
        end = os.path.getmtime(f) if f and os.path.isfile(f) else r["started"]
        c.execute("UPDATE sessions SET ended=? WHERE id=?", (end, r["id"]))
    c.commit()
    c.close()


# ------------------------------------------------------------------ pipeline
STATE = {
    "running": False, "source": None, "subcarriers": 0, "fs": 0.0, "frames": 0,
    "started": None, "error": None, "fs_meas": None, "link": None,
    "recording": False, "session_id": None, "session_label": None, "rec_started": None,
}
LOCK = threading.Lock()
SUBS = []
def _push(msg):
    data = "data: " + json.dumps(msg) + "\n\n"
    for q in list(SUBS):
        try:
            q.put_nowait(data)
        except queue.Full:
            pass


WORKER = {"cur": None}


class Capture(threading.Thread):
    daemon = True

    def __init__(self, cfg):
        threading.Thread.__init__(self)
        self.cfg = cfg
        self.stop_evt = threading.Event()
        self.rec = None                              # dict when recording

    @property
    def current(self):
        """A superseded thread must never write the shared STATE - a source
        blocked in recv() can outlive the join() in stop_capture()."""
        return WORKER.get("cur") is self

    # -- recording ---------------------------------------------------
    def start_recording(self, label, note):
        with LOCK:
            if self.rec:
                return self.rec["id"]
            now = time.time()
            raw_path = os.path.join(save_dir(), time.strftime("WS_%Y%m%d_%H%M%S.csv", time.localtime(now)))
            if os.path.exists(raw_path):
                raw_path = raw_path[:-4] + "_%d.csv" % int(now * 1000 % 1000)
            c = db()
            cur = c.execute(
                "INSERT INTO sessions(label,note,started,source,subcarriers,fs,raw_file,distance_cm)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (label or time.strftime("%Y-%m-%d %H:%M"), note or "", now, self.cfg["source"],
                 STATE["subcarriers"], self.cfg["fs"], raw_path, settings().get("distance_cm")))
            sid = cur.lastrowid
            c.commit()
            c.close()
            self.rec = {"id": sid, "t0": now, "n": 0, "raw": open(raw_path, "w"), "header": False}
            write_meta(sid)
            STATE.update(recording=True, session_id=sid, rec_started=now, session_label=label)
            return sid

    def stop_recording(self):
        with LOCK:
            if not self.rec:
                return None
            sid, n = self.rec["id"], self.rec["n"]
            self.rec["raw"].close()
            c = db()
            c.execute("UPDATE sessions SET ended=? WHERE id=?", (time.time(), sid))
            c.commit()
            c.close()
            self.rec = None
            STATE.update(recording=False, session_id=None, session_label=None, rec_started=None)
            write_meta(sid, packets=n)
            return sid

    # -- main loop ---------------------------------------------------
    def run(self):
        cfg = self.cfg
        n = None
        frames, last_push = 0, 0.0
        rate_t, rate_n = time.time(), 0              # true packet-rate meter
        live = []                                    # packets since the last push, for the trace view
        try:
            for amps in SOURCES[cfg["source"]](cfg, self.stop_evt):
                if self.stop_evt.is_set() or not self.current:
                    break
                if n is None:                        # lock geometry to the first frame
                    n = len(amps)
                    STATE.update(subcarriers=n, fs=cfg["fs"], running=True, error=None, started=time.time())
                if len(amps) != n:
                    continue
                frames += 1
                now = time.time()
                live.append([round(now, 3)] + [round(x, 1) for x in amps])
                rate_n += 1
                if now - rate_t >= 3.0:
                    STATE["fs_meas"] = round(rate_n / (now - rate_t), 1)
                    rate_t, rate_n = now, 0
                if now - last_push >= 0.1:           # stream at 10 Hz
                    last_push = now
                    STATE["frames"] = frames
                    _push(dict(STATE, packets=live))
                    live = []
                with LOCK:                           # Stop closes the file under this lock; never write after it
                    rec = self.rec
                    if rec:
                        if not rec["header"]:
                            rec["raw"].write("unix_time," + ",".join("s%d" % (k + 1) for k in range(n)) + "\n")
                            rec["header"] = True
                        # Unix time per packet, so a recording lines up with other devices.
                        rec["raw"].write("%.4f," % now + ",".join(_num3(x) for x in amps) + "\n")
                        rec["n"] += 1
        except Exception as e:
            if self.current:
                STATE["error"] = "%s: %s" % (type(e).__name__, e)
        finally:
            self.stop_recording()
            if self.current:
                STATE.update(running=False)
                _push(STATE)


def write_meta(sid, **extra):
    """The details that used to crowd the file name live in a .json next to the CSV."""
    c = db()
    r = c.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
    c.close()
    if not r or not r["raw_file"] or not r["raw_file"].endswith(".csv"):
        return
    path = r["raw_file"][:-4] + ".json"
    try:
        meta = json.load(open(path))
    except Exception:
        meta = {}
    iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(t)) if t else None
    meta.update({
        "app": "WaveSensr", "session_id": sid, "label": r["label"], "note": r["note"],
        "started_unix": r["started"], "started": iso(r["started"]),
        "ended_unix": r["ended"], "ended": iso(r["ended"]),
        "source": r["source"], "configured_rate_hz": r["fs"], "measured_rate_hz": STATE.get("fs_meas"),
        "slices": r["subcarriers"], "board_distance_cm": r["distance_cm"],
        "columns": "unix_time = packet arrival (Unix s); s1..sN = |CSI| per slice (HT-LTF), s1 lowest frequency",
    }, **extra)
    json.dump(meta, open(path, "w"), indent=2)


def start_capture(cfg):
    stop_capture()
    c = Capture(cfg)
    WORKER["cur"] = c                                # claim before .start()
    STATE.update(source=cfg["source"], running=True, error=None, frames=0, fs_meas=None, subcarriers=0)
    c.start()
    return c


def stop_capture():
    c = WORKER.get("cur")
    if c and c.is_alive():
        c.stop_evt.set()
        c.join(timeout=3)
    WORKER["cur"] = None
    STATE.update(running=False)


# ------------------------------------------------------------------ http
CFG = {"source": "serial", "fs": 60.0, "subcarriers": 56,
       "port": "/dev/tty.usbmodem1101", "baud": 921600, "bind": "0.0.0.0:5566"}

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
        ".gltf": "model/gltf+json", ".glb": "model/gltf-binary", ".bin": "application/octet-stream",
        ".jpg": "image/jpeg", ".png": "image/png"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "WaveSensr/1.0"

    def log_message(self, *a):
        pass

    # -- helpers -----------------------------------------------------
    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def _static(self, name):
        path = os.path.normpath(os.path.join(STATIC, name.lstrip("/")))
        if not path.startswith(STATIC) or not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        with open(path, "rb") as f:
            data = f.read()
        self._send(200, data, MIME.get(os.path.splitext(path)[1], "text/plain"))

    # -- GET ---------------------------------------------------------
    def do_GET(self):
        u = urlparse(self.path)
        p, q = u.path, parse_qs(u.query)

        if p == "/" or p == "/index.html":
            return self._static("index.html")
        if p.startswith("/static/"):
            return self._static(p[len("/static/"):])

        if p == "/api/state":
            # server_time lets a study script on another machine check the two clocks agree
            return self._send(200, dict(STATE, config=CFG, server_time=time.time()))

        if p == "/api/settings":
            st = settings()
            chosen = st.get("save_dir")
            return self._send(200, {"save_dir": chosen or DATA, "effective": save_dir(),
                                    "distance_cm": st.get("distance_cm"),
                                    "missing": bool(chosen) and not os.path.isdir(chosen)})

        if p == "/api/stream":
            qq = queue.Queue(maxsize=64)
            SUBS.append(qq)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                self.wfile.write(("data: " + json.dumps(STATE) + "\n\n").encode())
                self.wfile.flush()
                while True:
                    try:
                        self.wfile.write(qq.get(timeout=15).encode())
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except Exception:
                pass
            finally:
                if qq in SUBS:
                    SUBS.remove(qq)
            return

        if p == "/api/sessions":
            c = db()
            rows = c.execute(
                "SELECT * FROM sessions ORDER BY started DESC LIMIT 200").fetchall()
            c.close()
            return self._send(200, [dict(r) for r in rows])

        m = re.match(r"^/api/sessions/(\d+)$", p)
        if m:
            c = db()
            s = c.execute("SELECT * FROM sessions WHERE id=?", (m.group(1),)).fetchone()
            if not s:
                c.close()
                return self._send(404, {"error": "no such session"})
            c.close()
            return self._send(200, {"session": dict(s)})

        m = re.match(r"^/api/sessions/(\d+)/raw\.csv$", p)
        if m:
            sid = m.group(1)
            c = db()
            s_ = c.execute("SELECT raw_file FROM sessions WHERE id=?", (sid,)).fetchone()
            c.close()
            path = s_["raw_file"] if s_ else None
            if not path or not os.path.isfile(path):
                return self._send(404, {"error": "no raw file for this session"})
            view = "view" in q                       # Past player: thin long files to ~25 Hz
            if path.endswith(".csv") and view and os.path.getsize(path) > 8e6:
                with open(path) as f:
                    lines = f.readlines()
                t = [float(x.split(",", 1)[0] or "nan") for x in lines[1:201]]
                rate = (len(t) - 1) / (t[-1] - t[0]) if len(t) > 1 and t[-1] > t[0] else 60.0
                step = max(1, int(rate // 25))
                body = "".join(lines[:1] + lines[1::step]).encode()
            elif path.endswith(".csv"):
                with open(path, "rb") as f:
                    body = f.read()
            else:                                    # recordings made before 2026-09-16
                out = []
                for line in open(path):
                    v = json.loads(line)
                    t, a = (v["t"], v["a"]) if isinstance(v, dict) else ("", v)
                    a = _freq_order(_ht_only(a))         # same layout as new recordings
                    if not out:
                        out.append("unix_time," + ",".join("s%d" % (k + 1) for k in range(len(a))))
                    out.append(("%.4f" % t if t != "" else "") + "," + ",".join(_num3(x) for x in a))
                body = ("\n".join(out) + "\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv")
            self.send_header("Content-Disposition",
                             'attachment; filename="%s"' % (os.path.basename(path)
                                 if path.endswith(".csv") else "wavesensr_raw_%s.csv" % sid))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        return self._send(404, {"error": "not found"})

    # -- POST / DELETE ----------------------------------------------
    def do_POST(self):
        p = urlparse(self.path).path
        b = self._body()

        if p == "/api/start":
            cfg = dict(CFG)                          # validate before committing
            try:
                for k in ("source", "port", "bind"):
                    if b.get(k):
                        cfg[k] = str(b[k])
                for k in ("fs",):
                    if b.get(k) is not None:
                        cfg[k] = float(b[k])
                for k in ("subcarriers", "baud"):
                    if b.get(k) is not None:
                        cfg[k] = int(b[k])
            except (TypeError, ValueError) as e:
                return self._send(400, {"error": "bad value: %s" % e})
            if cfg["source"] not in SOURCES:
                return self._send(400, {"error": "unknown source"})
            if not (5.0 <= cfg["fs"] <= 5000.0):
                return self._send(400, {"error": "fs must be 5-5000 Hz"})
            if not (8 <= cfg["subcarriers"] <= 512):
                return self._send(400, {"error": "subcarriers must be 8-512"})
            CFG.update(cfg)
            start_capture(dict(CFG))
            # server_time lets a study script on another machine check the two clocks agree
            return self._send(200, dict(STATE, config=CFG, server_time=time.time()))

        if p == "/api/stop":
            stop_capture()
            return self._send(200, dict(STATE))

        if p == "/api/record/start":
            c = WORKER.get("cur")
            if not (c and c.is_alive()):
                return self._send(400, {"error": "capture is not running"})
            if not settings().get("distance_cm"):
                return self._send(400, {"error": "Enter the distance between the boards in Setup first."})
            for _ in range(50):                       # wait for geometry lock
                if STATE["subcarriers"]:
                    break
                time.sleep(0.1)
            sid = c.start_recording(b.get("label"), b.get("note"))
            return self._send(200, {"session_id": sid})

        if p == "/api/record/stop":
            c = WORKER.get("cur")
            sid = c.stop_recording() if c else None
            return self._send(200, {"session_id": sid})

        if p == "/api/settings" and "distance_cm" in b:
            try:
                cm = float(b["distance_cm"])
            except (TypeError, ValueError):
                cm = 0
            if not 10 <= cm <= 2000:
                return self._send(400, {"error": "Enter a distance from 10 to 2000 cm"})
            json.dump(dict(settings(), distance_cm=cm), open(SETTINGS, "w"))
            return self._send(200, {"ok": True, "distance_cm": cm})

        if p == "/api/settings":
            d = os.path.abspath(os.path.expanduser(str(b.get("save_dir") or "").strip()))
            if not b.get("save_dir"):
                return self._send(400, {"error": "Choose a folder"})
            try:
                os.makedirs(d, exist_ok=True)
                probe = os.path.join(d, ".wavesensr-write-test")
                open(probe, "w").close()
                os.remove(probe)
            except OSError as e:
                return self._send(400, {"error": "Can't write there: %s" % e.strerror})
            json.dump(dict(settings(), save_dir=d), open(SETTINGS, "w"))
            return self._send(200, {"ok": True, "save_dir": d})

        m = re.match(r"^/api/sessions/(\d+)/reveal$", p)
        if m:
            c = db()
            row = c.execute("SELECT raw_file FROM sessions WHERE id=?", (m.group(1),)).fetchone()
            c.close()
            path = row["raw_file"] if row else None
            if not path or not os.path.isfile(path):
                return self._send(404, {"error": "file not found"})
            import subprocess
            subprocess.Popen(["open", "-R", path])        # macOS: select it in Finder
            return self._send(200, {"ok": True})

        m = re.match(r"^/api/sessions/(\d+)/note$", p)
        if m:
            sid = m.group(1)
            label = b.get("label") or None
            c = db()
            c.execute("UPDATE sessions SET note=?, label=COALESCE(?,label) WHERE id=?",
                      (b.get("note", ""), label, sid))
            c.commit()
            c.close()
            write_meta(int(sid))
            return self._send(200, {"ok": True})

        return self._send(404, {"error": "not found"})

    def do_DELETE(self):
        m = re.match(r"^/api/sessions/(\d+)$", urlparse(self.path).path)
        if not m:
            return self._send(404, {"error": "not found"})
        sid = m.group(1)
        c = db()
        row = c.execute("SELECT raw_file FROM sessions WHERE id=?", (sid,)).fetchone()
        c.execute("DELETE FROM sessions WHERE id=?", (sid,))
        c.commit()
        c.close()
        f = row["raw_file"] if row else None
        for path in ([f, f[:-4] + ".json"] if f and f.endswith(".csv") else [f]):
            if path and os.path.isfile(path):
                os.remove(path)
        return self._send(200, {"ok": True})


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", default="serial", choices=sorted(SOURCES))
    ap.add_argument("--port", default=CFG["port"], help="serial device")
    ap.add_argument("--baud", type=int, default=CFG["baud"])
    ap.add_argument("--bind", default=CFG["bind"], help="udp host:port")
    ap.add_argument("--fs", type=float, default=CFG["fs"])
    ap.add_argument("--subcarriers", type=int, default=CFG["subcarriers"])
    ap.add_argument("--http", type=int, default=8777)
    ap.add_argument("--no-autostart", action="store_true")
    ap.add_argument("--open", action="store_true", help="open the page in a browser")
    a = ap.parse_args()
    CFG.update(source=a.source, port=a.port, baud=a.baud, bind=a.bind,
               fs=a.fs, subcarriers=a.subcarriers)
    db_init()

    srv = ThreadingHTTPServer(("127.0.0.1", a.http), Handler)
    srv.daemon_threads = True
    print("[wavesensr] source=%s" % CFG["source"])
    print("[wavesensr] http://localhost:%d" % a.http)
    if not a.no_autostart:
        start_capture(dict(CFG))
    if a.open:
        import webbrowser
        threading.Timer(1.0, webbrowser.open, ("http://localhost:%d" % a.http,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[wavesensr] stopping")
        stop_capture()


if __name__ == "__main__":
    main()
