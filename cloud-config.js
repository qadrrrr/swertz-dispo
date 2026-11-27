// Swertz Dispo – Verbindung zu Supabase
//
// Hier kommen NUR die zwei öffentlichen Angaben aus Supabase hinein:
//   Supabase → Projekt → „Project Settings“ → „API“
//     url     = „Project URL“          (z. B. https://abcdefgh.supabase.co)
//     anonKey = „publishable“-Schlüssel (beginnt mit „sb_publishable_…“)
//               bzw. bei älteren Projekten der „anon public“-Schlüssel („eyJ…“)
//
// NIEMALS den „service_role“-Schlüssel hier eintragen!
//
// Solange beide Felder leer sind, läuft das Programm wie bisher
// (nur auf diesem Gerät bzw. in Claude).
window.SWERTZ_CLOUD_CONFIG = {
  url: "https://tnvcwdfyzzlghiofbrws.supabase.co",
  anonKey: "sb_publishable_nAMevj9a_7gTyFk0Q6HHAw_pWuUt1ny"
};
