import http.server, json, os, subprocess, sys, threading, time, urllib.parse, uuid, webbrowser
from pathlib import Path

PORT = 7979
HOST = "127.0.0.1"
BASE_DIR = Path(__file__).parent.resolve()
EXE = BASE_DIR / "ytd.exe"
jobs = {}
jobs_lock = threading.Lock()

def build_args(s):
    args = [str(EXE)]
    url = s.get("url","").strip()
    if not url: raise ValueError("URL is required")
    fmt = s.get("format","video")
    quality = s.get("quality","best")
    audio_fmt = s.get("audio_format","mp3")
    audio_quality = s.get("audio_quality","192")
    output_dir = s.get("output_dir","").strip() or str(Path.home()/"Downloads")
    output_tmpl = s.get("output_template","%(title)s.%(ext)s")
    out_path = str(Path(output_dir)/output_tmpl)
    args += ["-o", out_path]
    if fmt == "audio":
        args += ["-x","--audio-format",audio_fmt,"--audio-quality",f"{audio_quality}K"]
    else:
        if quality == "best":
            args += ["-f","bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best","--merge-output-format","mp4"]
        elif quality in ("2160","1440","1080","720","480","360"):
            args += ["-f",f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={quality}]+bestaudio/best[height<={quality}]","--merge-output-format","mp4"]
        else:
            args += ["-f","bestvideo+bestaudio/best","--merge-output-format","mp4"]
    if not s.get("playlist",False): args.append("--no-playlist")
    if s.get("subtitles",False):
        args += ["--write-subs","--write-auto-subs","--sub-langs",s.get("sub_langs","en")]
        if s.get("embed_subs",False): args.append("--embed-subs")
    if s.get("embed_thumb",False): args.append("--embed-thumbnail")
    if s.get("metadata",True): args.append("--embed-metadata")
    if s.get("sponsorblock",False): args += ["--sponsorblock-remove","sponsor,intro,outro,selfpromo,interaction"]
    if s.get("rate_limit","").strip(): args += ["-r",s["rate_limit"].strip()]
    if s.get("cookies_from","").strip(): args += ["--cookies-from-browser",s["cookies_from"].strip()]
    if s.get("proxy","").strip(): args += ["--proxy",s["proxy"].strip()]
    if s.get("geo_bypass",False): args.append("--geo-bypass")
    args += ["--concurrent-fragments",str(s.get("concurrent_fragments",4)),"--retries",str(s.get("retries",10)),"--fragment-retries",str(s.get("retries",10)),"--newline"]
    args.append(url)
    return args

def run_job(job_id, args):
    with jobs_lock:
        jobs[job_id]["status"] = "running"
        jobs[job_id]["started_at"] = time.time()
    log_lines = []
    try:
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", cwd=str(BASE_DIR))
        with jobs_lock: jobs[job_id]["pid"] = proc.pid
        for line in proc.stdout:
            line = line.rstrip()
            log_lines.append(line)
            progress = None; speed = ""; eta = ""
            if line.startswith("[download]") and "%" in line:
                parts = line.split()
                for i,p in enumerate(parts):
                    if "%" in p:
                        try: progress = float(p.replace("%",""))
                        except: pass
                    if p == "at" and i+1 < len(parts): speed = parts[i+1]
                    if p == "ETA" and i+1 < len(parts): eta = parts[i+1]
            with jobs_lock:
                jobs[job_id]["log"] = log_lines[-200:]
                if progress is not None:
                    jobs[job_id]["progress"] = round(progress,1)
                    jobs[job_id]["speed"] = speed
                    jobs[job_id]["eta"] = eta
        proc.wait()
        with jobs_lock:
            jobs[job_id]["status"] = "done" if proc.returncode==0 else "error"
            jobs[job_id]["progress"] = 100 if proc.returncode==0 else jobs[job_id].get("progress",0)
            jobs[job_id]["finished_at"] = time.time()
    except Exception as exc:
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["log"] = log_lines + [f"[server error] {exc}"]
            jobs[job_id]["finished_at"] = time.time()

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,fmt,*args): pass
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path.rstrip("/") or "/"
        if path=="/": self._serve_file(BASE_DIR/"index.html","text/html; charset=utf-8")
        elif path=="/style.css": self._serve_file(BASE_DIR/"style.css","text/css; charset=utf-8")
        elif path=="/app.js": self._serve_file(BASE_DIR/"app.js","application/javascript; charset=utf-8")
        elif path=="/api/jobs": self._api_list_jobs()
        elif path.startswith("/api/jobs/"): self._api_job_status(path.split("/api/jobs/")[1].split("/")[0])
        elif path=="/api/defaults": self._json(200,{"output_dir":str(Path.home()/"Downloads"),"exe_found":EXE.exists()})
        else: self._json(404,{"error":"not found"})
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path.rstrip("/")
        if path=="/api/download": self._api_start_download()
        elif path.startswith("/api/jobs/") and path.endswith("/cancel"):
            self._api_cancel_job(path.split("/api/jobs/")[1].replace("/cancel",""))
        else: self._json(404,{"error":"not found"})
    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()
    def _api_start_download(self):
        body = self._read_json()
        if body is None: return
        try: args = build_args(body)
        except ValueError as e: self._json(400,{"error":str(e)}); return
        job_id = str(uuid.uuid4())[:8]
        with jobs_lock:
            jobs[job_id] = {"id":job_id,"url":body.get("url",""),"status":"queued","progress":0,"speed":"","eta":"","log":[],"created_at":time.time()}
        threading.Thread(target=run_job,args=(job_id,args),daemon=True).start()
        self._json(202,{"job_id":job_id})
    def _api_job_status(self,job_id):
        with jobs_lock: job = jobs.get(job_id)
        if job is None: self._json(404,{"error":"job not found"}); return
        self._json(200,job)
    def _api_list_jobs(self):
        with jobs_lock: all_jobs = list(jobs.values())
        self._json(200,[{k:v for k,v in j.items() if k!="log"} for j in all_jobs])
    def _api_cancel_job(self,job_id):
        with jobs_lock: job = jobs.get(job_id)
        if job is None: self._json(404,{"error":"job not found"}); return
        pid = job.get("pid")
        if pid:
            try: subprocess.call(["taskkill","/F","/T","/PID",str(pid)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            except: pass
        with jobs_lock: jobs[job_id]["status"] = "cancelled"
        self._json(200,{"ok":True})
    def _serve_file(self,path,ct):
        if not path.exists(): self._json(404,{"error":f"{path.name} not found"}); return
        data = path.read_bytes()
        self.send_response(200); self.send_header("Content-Type",ct); self.send_header("Content-Length",str(len(data))); self._cors(); self.end_headers(); self.wfile.write(data)
    def _read_json(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length",0)))
        try: return json.loads(raw)
        except: self._json(400,{"error":"invalid JSON"}); return None
    def _json(self,code,data):
        body = json.dumps(data,default=str).encode()
        self.send_response(code); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(body))); self._cors(); self.end_headers(); self.wfile.write(body)
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers","Content-Type")

def main():
    if not EXE.exists(): print(f"[WARN] ytd.exe not found at {EXE}")
    server = http.server.ThreadingHTTPServer((HOST,PORT),Handler)
    url = f"http://{HOST}:{PORT}"
    print(f"MoliDowloader -> {url}  (Ctrl+C to stop)")
    threading.Thread(target=lambda:(time.sleep(0.8),webbrowser.open(url)),daemon=True).start()
    try: server.serve_forever()
    except KeyboardInterrupt: server.shutdown()

if __name__=="__main__": main()
