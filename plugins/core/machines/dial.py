#!/usr/bin/env python3
"""Vaultite dial-in: shows this computer's files in a vault's Machines when nothing can reach it (a cloud agent's VM
behind its provider's firewall). It dials the vault's server and answers three questions, read-only: what's in a
folder, what's in a file, and which files changed last. It runs nothing and writes nothing but its own files. Python
3.8+, nothing to install.

  python3 agent.py connect <url>     the key on stdin: saves both, starts in the background, says once it's connected
  python3 agent.py start             in the background with what connect saved (nothing when it already runs)
  python3 agent.py stop | status
  python3 agent.py run               in the foreground

  python3 agent.py enroll <https-base> <id> [label]  generate a key locally and show an enrollment code

Its own files are in ~/.vaultite-dial (config.json, readable by you only; log; pid).
"""
import base64
import hashlib
import heapq
import fcntl
import stat
import json
import os
import platform
import queue
import select
import signal
import socket
import ssl
import struct
import sys
import threading
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

VERSION = "1"
HOME = os.path.expanduser("~")
DIR = os.path.join(HOME, ".vaultite-dial")
CONFIG, PIDFILE, LOG, STATE = (os.path.join(DIR, n) for n in ("config.json", "pid", "log", "state.json"))
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
READ_MAX, READ_CAP, LIST_CAP, FRAME_CAP = 1 << 20, 8 << 20, 5000, 1 << 20


def log(*parts):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(p) for p in parts)
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > 1 << 20:
            os.replace(LOG, LOG + ".1")
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass
    if sys.stderr.isatty():
        print(line, file=sys.stderr)


def note(state, **more):
    """Where it is, for `status` and for `connect` waiting on its first connection."""
    try:
        with open(STATE + ".tmp", "w") as f:
            json.dump(dict(state=state, at=time.time(), **more), f)
        os.replace(STATE + ".tmp", STATE)
    except OSError:
        pass


# --- a WebSocket client (RFC 6455): text frames, ping and close are all it needs


class Closed(Exception):
    pass


class Refused(Exception):
    """The server said no to the key: no point dialing again with it."""


def open_socket(host, port):
    """A TCP socket to host:port, through the HTTPS proxy the environment names, if any."""
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    skip = [h.strip().lstrip(".") for h in (os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or "").split(",") if h.strip()]
    if not proxy or any(host == h or host.endswith("." + h) for h in skip):
        return socket.create_connection((host, port), timeout=20)
    p = urlsplit(proxy if "://" in proxy else "http://" + proxy)
    s = socket.create_connection((p.hostname, p.port or 80), timeout=20)
    auth = ""
    if p.username:
        auth = "Proxy-Authorization: Basic %s\r\n" % base64.b64encode(("%s:%s" % (p.username, p.password or "")).encode()).decode()
    s.sendall(("CONNECT %s:%d HTTP/1.1\r\nHost: %s:%d\r\n%s\r\n" % (host, port, host, port, auth)).encode())
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = s.recv(4096)
        if not chunk:
            raise OSError("the proxy closed the connection")
        head += chunk
        if len(head) > 65536:
            raise OSError("proxy handshake too big")
    if head.split(b" ", 2)[1:2] != [b"200"]:
        raise OSError("the proxy said: " + head.split(b"\r\n", 1)[0].decode(errors="replace"))
    return s


def masked(data, mask):
    n = len(data)
    whole = int.from_bytes(data, "big") ^ int.from_bytes((mask * (n // 4 + 1))[:n], "big")
    return whole.to_bytes(n, "big")


class Socket:
    def __init__(self, url, key):
        u = urlsplit(url)
        secure = u.scheme in ("https", "wss")
        host, port = u.hostname, u.port or (443 if secure else 80)
        raw = open_socket(host, port)
        self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=host) if secure else raw
        nonce = base64.b64encode(os.urandom(16)).decode()
        path = (u.path or "/") + ("?" + u.query if u.query else "")
        self.sock.sendall(("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer %s\r\n"
                           "User-Agent: vaultite-dial/%s\r\n\r\n" % (path, u.netloc, nonce, key, VERSION)).encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise OSError("the server closed the connection")
            head += chunk
            if len(head) > 65536:
                raise OSError("handshake too big")
        head, self.buf = head.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n", 1)[0].decode(errors="replace")
        code = (status.split(" ") + ["", ""])[1]
        # A revoked key; a 404 can be a server still starting (or its machine list unreadable for a moment): tried again.
        if code in ("401", "403"):
            raise Refused(status)
        if code != "101":
            raise OSError("the server answered " + status)
        want = base64.b64encode(hashlib.sha1((nonce + GUID).encode()).digest()).decode()
        if ("sec-websocket-accept: " + want).lower() not in head.decode(errors="replace").lower():
            raise OSError("the server's handshake didn't check out")
        self.parts, self.size = [], 0
        self.sock.setblocking(False)

    def send(self, obj):
        self.frame(1, json.dumps(obj).encode())

    def frame(self, op, data):
        n = len(data)
        if n < 126:
            head = bytes([0x80 | op, 0x80 | n])
        elif n < 1 << 16:
            head = bytes([0x80 | op, 0xFE]) + struct.pack(">H", n)
        else:
            head = bytes([0x80 | op, 0xFF]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        self.sock.settimeout(20)  # (a whole frame out; reads never wait)
        try:
            self.sock.sendall(head + mask + (masked(data, mask) if n else b""))
        finally:
            self.sock.setblocking(False)

    def pump(self):
        """Take in what has arrived, without waiting: whether anything had."""
        got = False
        while True:
            try:
                chunk = self.sock.recv(65536)
            except (ssl.SSLWantReadError, ssl.SSLWantWriteError, BlockingIOError, InterruptedError):
                return got
            if not chunk:
                raise Closed("the connection ended")
            self.buf += chunk
            got = True
            if len(self.buf) > FRAME_CAP + 16:
                raise Closed("a message too big")

    def messages(self):
        """The text messages complete in what has arrived (pings answered on the way)."""
        out = []
        while len(self.buf) >= 2:
            b0, b1 = self.buf[0], self.buf[1]
            op, n, at = b0 & 0x0F, b1 & 0x7F, 2
            if n == 126:
                if len(self.buf) < 4:
                    break
                n, at = struct.unpack(">H", self.buf[2:4])[0], 4
            elif n == 127:
                if len(self.buf) < 10:
                    break
                n, at = struct.unpack(">Q", self.buf[2:10])[0], 10
            if self.size + n > FRAME_CAP or b1 & 0x80:
                raise Closed("a message too big")
            if len(self.buf) < at + n:
                break
            data, self.buf = self.buf[at:at + n], self.buf[at + n:]
            if op == 8:
                raise Closed("the server closed it: " + data[2:].decode(errors="replace"))
            if op == 9:
                self.frame(10, data)
                continue
            if op == 10:
                continue
            self.parts.append(data)
            self.size += n
            if b0 & 0x80:
                out.append(b"".join(self.parts).decode("utf-8", errors="replace"))
                self.parts, self.size = [], 0
        return out

    def close(self):
        try:
            self.frame(8, struct.pack(">H", 1000))
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


# --- what it answers: a folder's entries and a file's contents, nothing else


def full(p):
    p = os.path.expanduser(str(p or "~"))
    return os.path.abspath(p if os.path.isabs(p) else os.path.join(HOME, p))


def ls(args):
    p = full(args.get("path"))
    entries = []
    with os.scandir(p) as it:
        for e in it:
            if len(entries) >= LIST_CAP:
                break
            try:
                st = e.stat()
                isdir = e.is_dir()
            except OSError:
                st, isdir = None, False
            entries.append({"name": e.name, "dir": isdir, "link": e.is_symlink(),
                            "size": st.st_size if st and not isdir else None, "mtime": int(st.st_mtime * 1000) if st else None})
    entries.sort(key=lambda x: (not x["dir"], x["name"].casefold()))
    return {"path": p, "parent": os.path.dirname(p) if p != "/" else None, "entries": entries, "truncated": len(entries) >= LIST_CAP}


def read(args):
    p = full(args.get("path"))
    if os.path.isdir(p):
        raise IsADirectoryError("a folder: list it instead")
    cap = max(1, min(int(args.get("max") or READ_MAX), READ_CAP))
    st = os.stat(p)
    fd = os.open(p, os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode):
            raise ValueError("only regular files can be read")
        data = f.read(cap)
    out = {"path": p, "size": st.st_size, "mtime": int(st.st_mtime * 1000), "truncated": st.st_size > len(data)}
    text = None
    if b"\0" not in data[:8192]:
        for cut in range(4):  # (a cut in the middle of a character, at the end)
            try:
                text = (data[:-cut] if cut else data).decode("utf-8")
                break
            except UnicodeDecodeError:
                continue
    if text is not None:
        out["text"] = text
    else:
        out["base64"] = base64.b64encode(data).decode()
    return out


SKIP = {"node_modules", "__pycache__", "venv", "site-packages"}


def recent(args):
    """The files changed last under a folder, newest first: hidden folders and dependencies left out, a few seconds'
    walk at most."""
    root = full(args.get("path"))
    limit = max(1, min(int(args.get("limit") or 50), 200))
    best, stack, seen, until, truncated = [], [root], 0, time.time() + 3, False
    while stack:
        if seen >= 100000 or time.time() > until:
            truncated = True
            break
        try:
            it = os.scandir(stack.pop())
        except OSError:
            continue
        with it:
            for e in it:
                seen += 1
                if e.name.startswith(".") or e.name in SKIP:
                    continue
                try:
                    if e.is_dir(follow_symlinks=False):
                        stack.append(e.path)
                        continue
                    if not e.is_file(follow_symlinks=False):
                        continue
                    st = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                item = (st.st_mtime, e.path, st.st_size)
                if len(best) < limit:
                    heapq.heappush(best, item)
                elif item > best[0]:
                    heapq.heapreplace(best, item)
    files = [{"path": p, "size": size, "mtime": int(m * 1000)} for m, p, size in sorted(best, reverse=True)]
    return {"path": root, "files": files, "truncated": truncated}


OPS = {"ls": ls, "read": read, "recent": recent}


def answer(msg):
    rid, op = msg.get("id"), OPS.get(msg.get("op"))
    try:
        if not op:
            raise ValueError("this computer only lists folders and reads files")
        return {"t": "res", "id": rid, "ok": True, "data": op(msg.get("args") or {})}
    except Exception as e:  # (any failure is the request's answer, never the connection's end)
        return {"t": "res", "id": rid, "ok": False, "error": "%s: %s" % (type(e).__name__, e)}


def hello():
    return {"t": "hello", "v": VERSION, "host": socket.gethostname(), "platform": sys.platform, "os": platform.platform(terse=True),
            "user": os.environ.get("USER") or os.environ.get("LOGNAME") or "", "home": HOME, "python": platform.python_version()}


def run():
    cfg = load()
    if not cfg:
        sys.exit("not set up: python3 agent.py connect <url>, with the key on stdin")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    wait = 1
    while True:
        try:
            ws = Socket(cfg["url"], cfg["key"])
        except Refused as e:
            log("refused:", e, "(the key is revoked or the machine removed: connect again with a new key)")
            note("refused", reason=str(e))
            sys.exit(1)
        except Exception as e:
            log("can't dial:", e)
            note("retrying", reason=str(e))
            time.sleep(wait)
            wait = min(wait * 2, 60)
            continue
        log("connected to", cfg["url"])
        note("connected")
        wait = 1
        # Only this thread touches the socket (TLS can't take a read and a write at once from two threads): answers
        # are worked out on others and queued, and the socket pair wakes this one to send them.
        outbox, slots = queue.Queue(), threading.BoundedSemaphore(16)
        wake_r, wake_w = socket.socketpair()
        wake_r.setblocking(False)
        wake_w.setblocking(False)

        def work(msg):
            try:
                outbox.put(answer(msg))
            finally:
                slots.release()
                try:
                    wake_w.send(b".")
                except OSError:
                    pass
        try:
            ws.send(hello())
            heard, beat = time.time(), time.time() + 25
            while True:
                ready = select.select([ws.sock, wake_r], [], [], max(0.0, min(beat, heard + 90) - time.time()))[0]
                if wake_r in ready:
                    try:
                        wake_r.recv(4096)
                    except OSError:
                        pass
                while not outbox.empty():
                    ws.send(outbox.get_nowait())
                if ws.sock in ready and ws.pump():
                    heard = time.time()
                    for text in ws.messages():
                        msg = json.loads(text)
                        if msg.get("t") != "req":
                            continue
                        if slots.acquire(blocking=False):
                            threading.Thread(target=work, args=(msg,), daemon=True).start()
                        else:
                            ws.send({"t": "res", "id": msg.get("id"), "ok": False, "error": "Busy: too many reads at once"})
                now = time.time()
                if now - heard > 90:
                    raise Closed("nothing heard for 90 s")
                if now >= beat:
                    ws.frame(9, b"")
                    beat = now + 25
        except Exception as e:
            log("disconnected:", e)
            note("retrying", reason=str(e))
        finally:
            ws.close()
            wake_r.close()
            wake_w.close()
        time.sleep(1)


# --- set up, start and stop


def load():
    try:
        with open(CONFIG) as f:
            c = json.load(f)
        return c if c.get("url") and c.get("key") else None
    except (OSError, ValueError):
        return None


def running():
    try:
        with open(PIDFILE + ".lock", "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return None
            except BlockingIOError:
                pass
        with open(PIDFILE) as f:
            pid = int(f.read().strip())
        os.kill(pid, 0)
        return pid
    except (OSError, ValueError):
        return None


def start():
    if running():
        return running()
    child = os.fork()
    if child:
        os.waitpid(child, 0)
        time.sleep(0.5)
        return running()
    os.setsid()
    if os.fork():
        os._exit(0)
    lock = open(PIDFILE + ".lock", "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os._exit(0)
    with open(PIDFILE, "w") as f:
        f.write(str(os.getpid()))
    null = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(null, fd)
    try:
        run()
    finally:
        try:
            os.unlink(PIDFILE)
        except OSError:
            pass
        os._exit(0)


def main():
    os.makedirs(DIR, mode=0o700, exist_ok=True)
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "enroll":
        if len(sys.argv) < 4:
            sys.exit("python3 agent.py enroll <https-base> <id> [label]")
        base, ident = sys.argv[2].rstrip("/"), sys.argv[3]
        u = urlsplit(base)
        if u.scheme != "https" and not (u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1")):
            sys.exit("use HTTPS (HTTP is only allowed for a local test)")
        key = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
        h = base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest()).decode().rstrip("=")
        body = json.dumps({"id": ident, "label": sys.argv[4] if len(sys.argv) > 4 else ident, "hash": h, "hello": hello()}).encode()
        req = Request(base + "/machines/enroll", data=body, headers={"Content-Type": "application/json", "User-Agent": "vaultite-dial/%s" % VERSION})
        with urlopen(req, timeout=20) as r:
            enrolled = json.load(r)
        fd = os.open(CONFIG + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"url": enrolled["url"].replace("https://", "wss://", 1).replace("http://", "ws://", 1), "key": key}, f)
        os.replace(CONFIG + ".tmp", CONFIG)
        pid = running()
        if pid:
            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
        note("waiting for approval")
        start()
        print("Enrollment code: " + enrolled["code"] + " (ten minutes). Approve it in Vaultite's Machines on the relay server.")
    elif cmd == "connect":
        if len(sys.argv) < 3:
            sys.exit("python3 agent.py connect <url>, with the key on stdin")
        key = sys.stdin.readline().strip()
        if not key:
            sys.exit("no key on stdin")
        url = sys.argv[2].replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        fd = os.open(CONFIG + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"url": url, "key": key}, f)
        os.replace(CONFIG + ".tmp", CONFIG)
        pid = running()
        if pid:
            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
        note("starting")
        start()
        for _ in range(30):
            time.sleep(0.5)
            try:
                with open(STATE) as f:
                    s = json.load(f)
            except (OSError, ValueError):
                continue
            if s["state"] == "connected":
                print("Connected: this computer's files show in the vault's Machines (read-only).")
                return
            if s["state"] == "refused":
                sys.exit("Refused: " + s.get("reason", "") + " (ask for a new key)")
        sys.exit("Not connected yet: see ~/.vaultite-dial/log (it keeps trying in the background)")
    elif cmd == "start":
        print("running" if start() else "couldn't start: see ~/.vaultite-dial/log")
    elif cmd == "stop":
        pid = running()
        if pid:
            os.kill(pid, signal.SIGTERM)
        print("stopped" if pid else "not running")
    elif cmd == "status":
        try:
            with open(STATE) as f:
                s = json.load(f)
        except (OSError, ValueError):
            s = {"state": "never started"}
        print(("running" if running() else "not running") + ", " + s["state"] + (": " + s["reason"] if s.get("reason") else ""))
    elif cmd == "run":
        run()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
