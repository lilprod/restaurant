// Applique le thème avant le premier rendu (pas de flash clair → sombre).
(function () {
  try {
    var pref = localStorage.getItem("restaurant.theme") || "system";
    var dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {}
})();
