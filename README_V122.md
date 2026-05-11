# GLOMART V122 Cloudtype Server

Fixes Cloudtype `EACCES: permission denied, mkdir '/app/data'`.

## Important
- Do not write DB under `/app/data`.
- Use persistent disk mount `/data` if Cloudtype disk is configured.
- Without disk, this server uses `/tmp/glomart-data/glomart.db`; it works for testing but can reset.

## Upload files
- server.js
- schema.sql
- package.json

## Check
- /health
- /db/status
