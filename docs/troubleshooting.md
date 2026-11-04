# Troubleshooting

**The eyes never smile.** Run **Calibrate Eye Contact…** from the menu and look straight into the eyes for 3 seconds.
If it still does not work, open **Settings → Advanced** and lower "Eye contact strictness".
Turn on **Show Debug Info** to see the live numbers (contact score, yaw, pitch, eye direction).

**The eyes look the wrong way (left/right swapped).** Turn on **Mirror Camera**. Some external cameras send mirrored images.

**The eyes disappear right away.** A key press, a click, or moving the mouse onto the eyes hides them.
A program that sends fake key presses (some remote desktop or "keep awake" tools) can also hide them.

**The eyes never appear.** Check that the app is not paused, the wait time in **Show After**, and on macOS
the option **Don't Show During Video**: a video call or a paused video in a browser tab can keep the display awake.
On macOS you can check with `pmset -g assertions`.

**"I can't see you".** The camera could not be opened or no face was found. Check camera access:
- macOS: System Settings → Privacy & Security → Camera → Big Eyes.
- Windows: Settings → Privacy & security → Camera.
Then try another camera in the **Camera** menu.

**Linux: no transparency or the eyes are under other windows.** Use an X11 session, and make sure a compositor runs.
