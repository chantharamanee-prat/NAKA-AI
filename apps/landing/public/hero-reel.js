// The 15 s "ฟ้าหลังฝน" reel (creative/sky-reel, rendered with HyperFrames) in a native <dialog>:
// nothing downloads until someone asks for it, it plays with sound because the click allows it,
// and closing (button, Esc or the backdrop) stops it and rewinds.
(() => {
  const open = document.querySelector("[data-reel-open]");
  const dialog = document.getElementById("reel-dialog");
  if (!open || !dialog || typeof dialog.showModal !== "function") {
    if (open) open.hidden = true;
    return;
  }
  const video = dialog.querySelector("video");
  const stop = () => { video.pause(); video.currentTime = 0; };

  open.addEventListener("click", () => {
    dialog.showModal();
    video.play().catch(() => {});
  });
  dialog.addEventListener("close", stop);
  dialog.querySelector("[data-reel-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
})();
