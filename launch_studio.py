"""Videomaker local-only bridge for Montage AI. Requires requests."""
import json,os,re,tempfile
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote,unquote,urlparse
try: import requests
except ImportError: raise SystemExit("Install dependencies: py -m pip install -r requirements-bridge.txt")
BASE=os.environ.get("MONTAGE_URL","http://127.0.0.1:8080").rstrip("/")
PORT=int(os.environ.get("VIDEOMAKER_PORT","8765"))
ROOT=Path(__file__).resolve().parent
def safe(raw):
    s=os.path.basename(unquote(raw).replace("\\","/"))
    if not re.fullmatch(r"[\w\-. ()\[\]а-яА-ЯёЁ]{1,180}",s,re.U) or s in (".",".."):raise ValueError("Недопустимое имя файла")
    return s
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def reply(self,obj,status=200):
        b=json.dumps(obj,ensure_ascii=False).encode()
        self.send_response(status);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Content-Length",str(len(b)));self.send_header("Cache-Control","no-store");self.end_headers();self.wfile.write(b)
    def forward(self,path):
        try:
            r=requests.get(BASE+path,timeout=(3,45),allow_redirects=False)
            try: obj=r.json()
            except ValueError: obj={"message":r.text[:500]}
            self.reply(obj,r.status_code)
        except requests.RequestException as e:self.reply({"error":str(e)[:500]},502)
    def do_GET(self):
        path=urlparse(self.path).path
        if path=="/bridge/health":
            try:
                r=requests.get(BASE+"/api/status",timeout=(2,5))
                self.reply({"studio":"ready","montage":{"online":r.ok,"status":r.status_code}})
            except requests.RequestException:self.reply({"studio":"ready","montage":{"online":False}})
            return
        if path.startswith("/bridge/jobs/"):
            key=path.split("/")[-1]
            if not re.fullmatch("[A-Za-z0-9_-]{1,130}",key):return self.reply({"error":"Invalid ID"},400)
            return self.forward("/api/jobs/"+key)
        if path.startswith("/bridge/download/"):
            try:
                name=safe(path.split("/")[-1])
                r=requests.get(BASE+"/api/download/"+quote(name),stream=True,timeout=(4,600),allow_redirects=False)
                if not r.ok:return self.reply({"error":"Download failed","status":r.status_code},502)
                self.send_response(200);self.send_header("Content-Type","video/mp4")
                self.send_header("Content-Disposition","attachment; filename*=UTF-8''"+quote(name))
                if r.headers.get("Content-Length"):self.send_header("Content-Length",r.headers["Content-Length"])
                self.end_headers()
                for b in r.iter_content(524288):
                    if b:self.wfile.write(b)
                r.close()
            except (ValueError,requests.RequestException,BrokenPipeError) as e:print("Download error:",e)
            return
        if path.startswith("/bridge/"):return self.reply({"error":"Not found"},404)
        return super().do_GET()
    def do_POST(self):
        path=urlparse(self.path).path
        if path=="/bridge/upload":
            try:
                name=safe(self.headers.get("X-VM-Name",""))
                kind=self.headers.get("X-VM-Type","")
                if kind not in ("music","video"):raise ValueError("Invalid media type")
                ext=Path(name).suffix.lower()
                allowed={".mp4",".mov",".webm",".m4v",".mkv"} if kind=="video" else {".mp3",".wav",".m4a",".aac",".ogg"}
                if ext not in allowed:raise ValueError("Unsupported file type")
                size=int(self.headers.get("Content-Length","-1"))
                if size<=0 or size>2*1024**3:raise ValueError("File too large or empty")
                with tempfile.TemporaryFile() as f:
                    remaining=size
                    while remaining:
                        b=self.rfile.read(min(1024**2,remaining))
                        if not b:raise ValueError("Upload interrupted")
                        f.write(b);remaining-=len(b)
                    f.seek(0)
                    r=requests.post(BASE+"/api/upload",files={"file":(name,f)},data={"type":kind},timeout=(5,1800),allow_redirects=False)
                    try: obj=r.json()
                    except ValueError:obj={"message":r.text[:350]}
                    self.reply(obj,r.status_code)
            except (ValueError,requests.RequestException) as e:self.reply({"error":str(e)[:500]},400)
            return
        if path=="/bridge/jobs":
            try:
                length=int(self.headers.get("Content-Length","0"))
                if length<=0 or length>16384:raise ValueError("Invalid request size")
                payload=json.loads(self.rfile.read(length))
                if payload.get("style") not in ("dynamic","hitchcock","mtv","action","minimalist"):raise ValueError("Unsupported style")
                payload.update({"cgpu":False,"cloud_acceleration":False,"upscale":False})
                r=requests.post(BASE+"/api/jobs",json=payload,timeout=(5,40),allow_redirects=False)
                try:obj=r.json()
                except ValueError:obj={"message":r.text[:350]}
                self.reply(obj,r.status_code)
            except (ValueError,requests.RequestException) as e:self.reply({"error":str(e)[:500]},400)
            return
        return self.reply({"error":"Not found"},404)
if __name__=="__main__":
    if urlparse(BASE).hostname not in ("127.0.0.1","localhost"):raise SystemExit("Montage URL must be localhost")
    print("VIDEOMAKER STUDIO: http://127.0.0.1:"+str(PORT))
    print("MONTAGE API:",BASE)
    ThreadingHTTPServer(("127.0.0.1",PORT),Handler).serve_forever()
