# VintageAnima

A static prompt studio for the VintageAnima model. It builds captions in the same order as the training pack: prefix, year, decade, characters, series, description, scan size, character designer, then quality.

Picking a series fills the year, the scan size, and the character designer. Any of those can be changed by hand, cleared, or reset. Character and designer can both be left empty.

Step-by-step is the full form. Quick Create is the same caption, with the sections stacked down two independent columns. The Index fills the form area with an A–Z list. Choosing a title opens its cast underneath the name, with a colored count of how many training stills used that name, and the dark panel shows the series record, including Anilist links. Characters lists every person from every series, sorted by that count. Blue is rare, yellow is in the middle, and red was named on many stills. Drag the color bar to move through the list. Portraits load as they come into view.

The page is client-side. Series, cast, and designers are loaded from `assets/data.json`. Nothing is uploaded.

Site: https://zetaneko.github.io/vintage-anima/

To open it locally, run a static server in this folder:

```bash
python -m http.server 8765
```

Then open http://127.0.0.1:8765/
