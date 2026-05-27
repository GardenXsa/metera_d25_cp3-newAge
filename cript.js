[1mdiff --git a/main.js b/main.js[m
[1mindex f16d908..febeec8 100755[m
[1m--- a/main.js[m
[1m+++ b/main.js[m
[36m@@ -93,10 +93,10 @@[m [mconst MAX_READ_SAVE_CHUNK_BYTES = getConfigNumber(['server', 'max_read_save_chun[m
 const WORLD_PREVIEW_BYTES = getConfigNumber(['server', 'world_preview_bytes'], 512);[m
 const SAVE_PREVIEW_BYTES = getConfigNumber(['server', 'save_preview_bytes'], 1024);[m
 const MIME_TYPES = {[m
[31m-  '.html': 'text/html',[m
[31m-  '.js': 'text/javascript',[m
[31m-  '.css': 'text/css',[m
[31m-  '.json': 'application/json',[m
[32m+[m[32m  '.html': 'text/html; charset=utf-8',[m
[32m+[m[32m  '.js': 'text/javascript; charset=utf-8',[m
[32m+[m[32m  '.css': 'text/css; charset=utf-8',[m
[32m+[m[32m  '.json': 'application/json; charset=utf-8',[m
   '.png': 'image/png',[m
   '.jpg': 'image/jpg',[m
   '.jpeg': 'image/jpeg',[m
