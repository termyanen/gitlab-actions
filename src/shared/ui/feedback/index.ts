import { isExtensionValid } from "../../api/runtime";
export function createFeedback(
  getSettings: () => Promise<{
    sound_enabled: boolean;
    notifications_enabled: boolean;
  }>,
) {
  // =========================================================================
  // UI
  // =========================================================================

  function showToast(
    message: string,
    type: "success" | "error",
    quiet?: boolean,
  ) {
    try {
      const existing = document.querySelectorAll(".gl-mr-actions-toast");
      existing.forEach(function (el) {
        el.remove();
      });

      const toast = document.createElement("div");
      toast.className = "gl-mr-actions-toast " + type;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(function () {
        try {
          toast.remove();
        } catch {
          /* Optional browser feedback is best effort. */
        }
      }, 5000);

      // Sound & notification — skip if extension was reloaded or quiet mode
      if (!quiet && isExtensionValid()) {
        getSettings()
          .then(function (s) {
            if (isExtensionValid() && s.sound_enabled)
              playSound(type === "error" ? "error" : "success");
            if (
              isExtensionValid() &&
              s.notifications_enabled !== false &&
              message &&
              "Notification" in window &&
              Notification.permission === "granted"
            ) {
              new Notification("GitLab MR Actions", {
                body: message,
                silent: false,
              });
            }
          })
          .catch(function () {});
      }
    } catch {
      /* Optional browser feedback is best effort. */
    }
  }

  function playSound(type: "success" | "error") {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const notes =
        type === "error"
          ? [
              [400, 0, 0.15],
              [280, 0.18, 0.15],
            ]
          : [
              [523, 0, 0.12],
              [659, 0.1, 0.12],
              [784, 0.2, 0.18],
            ];
      const vol = type === "error" ? 0.18 : 0.15;
      notes.forEach(function (n) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = n[0];
        gain.gain.setValueAtTime(vol, now + n[1]);
        gain.gain.exponentialRampToValueAtTime(0.001, now + n[1] + n[2]);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + n[1]);
        osc.stop(now + n[1] + n[2]);
      });
      setTimeout(function () {
        try {
          ctx.close();
        } catch {
          /* Optional browser feedback is best effort. */
        }
      }, 1000);
    } catch {
      /* Optional browser feedback is best effort. */
    }
  }
  return { showToast };
}
