# data/

`conduit_master_2025_2026.csv` is the recorded archive of the Conduit@Empathy1
station at JKUAT: 45,043 rows every 15 minutes from 1 June 2025 to
8 September 2026, exported from the Conduit dashboard. It is committed so the
app, the tests and the model fit all work without a key or a network.

## What uses it

- **The model fit.** `npm run fit` fits the WBGT forecast and the environmental
  states on it (see the README, section 4).
- **Fallback.** When neither live feed answers, the app serves the archive's
  most recent window and reports its age: data older than three hours
  is POOR and recommendations are suppressed.
- **History and replay.** The Dashboard's history explorer and historical
  replay read any range it covers, topped up from the Conduit API for anything
  newer when a key is set.

## Format

The columns match the Conduit API's rows:

```
ts,rg1,rg2,rg1tt,rg2tt,rg1tp,rg2tp,temp_bmx,press_bmx,temp_mcp,temp_sht,humidity_sht,si1145_vis,si1145_ir,si1145_uv,wind_spd,wind_dir,wind_gust,wind_gust_dir,heat_idx,wet_bulb_temp,wet_bulb_globe_temp
```

`-999.9` means missing. `wind_gust_dir` is never read: the exports copy the
gust speed into it. `wet_bulb_globe_temp` is the firmware's own value and is
kept only for reference; see the README for why.

## Refreshing it

Export a newer file from the Conduit dashboard with the same columns, replace
this one (or point `CONDUIT_CSV_PATH` at another file), and run `npm run fit`
to refit the models on the longer record. The app notices the new file by its
modification time; no restart is needed.
