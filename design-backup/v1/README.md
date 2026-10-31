# Old design (v1) backup

The look Doorbell had before the October 2026 redesign: Plus Jakarta Sans, pastel tiles,
a white app frame floating on a light-blue background, the old lime bell logo.

* `style.css` and `index.html`: the old files, exactly as they were.
* `logo.svg`: the old logo (it lived in `Logo()` inside `src/ui.jsx`).

To bring the old look back, copy `style.css` over `src/style.css` (and `index.html` over `index.html`),
or restore everything from the git tag **`design-v1`**:

```bash
git checkout design-v1 -- src/style.css index.html src/ui.jsx
```
