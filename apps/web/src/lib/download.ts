/** Enregistre un fichier téléchargé via l'API (le jeton de session est ajouté par le client, pas par un simple lien). */
export function saveBlob(file: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
