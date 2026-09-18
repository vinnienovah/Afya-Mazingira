# data/

Local Conduit CSV archive, used as a fallback when the live Conduit API
(`conduit.jhubafrica.com`) is unreachable — currently blocked by that host's
Imunify360 bot-protection from most automated/server networks.

## How it works

Drop a CSV export from the Conduit dashboard here, named
`conduit_master_2025_2026.csv` (or point `CONDUIT_CSV_PATH` in `.env` at a
different file/location). The columns must match the raw Conduit API row
shape exactly:

```
ts,rg1,rg2,rg1tt,rg2tt,rg1tp,rg2tp,temp_bmx,press_bmx,temp_mcp,temp_sht,humidity_sht,si1145_vis,si1145_ir,si1145_uv,wind_spd,wind_dir,wind_gust,wind_gust_dir,heat_idx,wet_bulb_temp,wet_bulb_globe_temp
```

The app tries, in order:
1. **Live Conduit API** — if `CONDUIT_API_KEY`/`CONDUIT_EMAIL` are set and the
   request succeeds.
2. **This CSV archive** — real recorded station data. If the requested time
   is more recent than the file's last row, it serves that last row's window
   and reports data quality/freshness honestly (it will show `POOR` once the
   archive is more than ~18 hours stale — that's expected and correct, not a
   bug).
3. **Synthetic demo data** — only if neither of the above covers the request.

The file is re-read automatically whenever it changes (checked by
modification time) — no server restart needed. Update it by re-exporting
from Conduit and replacing the file whenever you want fresher data.

CSV files in this folder are gitignored (they're a local operational cache,
not project source) — only this README is tracked.
