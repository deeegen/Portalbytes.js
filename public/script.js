// -------------------------
// Small niceties and UX helpers
// -------------------------
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

const q = document.getElementById("q");
const clearBtn = document.getElementById("clearBtn");
const goBtn = document.getElementById("goBtn");
const status = document.getElementById("status");

// Focus input on load for non-coarse pointers
window.addEventListener("load", () => {
  try {
    if (!matchMedia("(pointer: coarse)").matches) {
      q.focus({ preventScroll: true });
    }
  } catch (e) {
    // fallback: just focus
  }
});

// Show/hide clear button
function updateClearVisibility() {
  clearBtn.hidden = !q.value.trim();
}
q.addEventListener("input", updateClearVisibility);

clearBtn.addEventListener("click", () => {
  q.value = "";
  q.focus();
  updateClearVisibility();
  status.textContent = "";
});

// Ctrl/Cmd + K to focus input
window.addEventListener("keydown", (e) => {
  const key = e.key ? e.key.toLowerCase() : "";
  if ((e.ctrlKey || e.metaKey) && key === "k") {
    e.preventDefault();
    q.focus();
  }
});

// Re-enable submit button if user changes input (UX nicety)
q.addEventListener("input", () => {
  if (goBtn.disabled) goBtn.disabled = false;
});

// Initialize clear visibility on load (in case of persisted autofill)
updateClearVisibility();
