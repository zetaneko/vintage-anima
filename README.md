# VintageAnima

A static prompt studio for the VintageAnima model. It builds captions in the same order as the training pack: prefix, year, decade, characters, series, description, scan size, character designer, then quality.

Picking a series fills the year, the scan size, and the character designer. Any of those can be changed by hand, cleared, or reset. Character and designer can both be left empty.

The page is client-side. Series, cast, and designers are loaded from `assets/data.json`. Nothing is uploaded.

Site: https://zetaneko.github.io/vintage-anima/

To open it locally, run a static server in this folder:

```bash
python -m http.server 8765
```

Then open http://127.0.0.1:8765/
