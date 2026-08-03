# Sound samples

This directory is for **bubble wrap only**. The rain stick and thumb piano make their own
sound with oscillators and filtered noise and need no files at all - see the Sound section
of the top-level README for why those two synthesise and this one does not.

Drop the bubble wrap pops in this directory, named exactly:

```
pop-1.mp3
pop-2.mp3
pop-3.mp3
pop-4.mp3
```

Vite copies everything under `renderer/public/` into `dist/renderer/` unchanged, so these
land at `dist/renderer/sounds/pop-1.mp3`, which is where both loaders look.

## What the code expects

The filename list lives in `renderer/audio.ts` (`POP_FILES`). Add a fifth sample by adding
it there; nothing else needs to change. Only `.mp3`, `.ogg` and `.wav` names are accepted,
and only bare filenames - `main/samples.ts` refuses anything with a path in it.

Missing files are not an error. Each sample is loaded independently and a failure is
skipped, so three files gives you three pops and zero files gives you silence. Nothing
throws and the sheet still pops visually either way.

## Choosing the files

- **Short.** 100-250 ms. A drag across the sheet fires several in a row, and anything with
  a tail turns that into mush. Trim leading silence especially - it is heard as lag
  between the bubble collapsing and the sound.
- **Quiet is fine.** Playback is scaled to 0.35 gain with a little jitter, so record or
  normalise at a comfortable level rather than to the ceiling.
- **Four distinct ones.** They are chosen at random without repeating the previous pick,
  and each voice gets a few percent of pitch and level jitter on top. Four samples that
  differ get you an unguessable sheet; four near-identical ones just sound like one.
- **Mono is enough** and halves the decode.

## Turning it on

Sound is off unless `soundEnabled` is true in `config.json`, in the app's userData
directory (`%APPDATA%/claude-arcade/config.json` on Windows):

```json
{ "soundEnabled": true }
```

It is read on every appearance, so an edit takes effect the next time the widget shows -
no restart. To hear it without launching Electron, run the renderer dev server and open
the harness with sound forced on: `/harness.html?only=bubble-wrap&sound=1`.
