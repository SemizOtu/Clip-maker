// Düzenleme modunun değişiklikleri kaydedeceği GitHub deposu.
// Depoyu yeniden adlandırırsan "repo" satırını da güncelle
// (ya da düzenleme modunda Ayarlar → Gelişmiş bölümünden değiştir).
export const CONFIG = {
  owner: 'SemizOtu',
  repo: 'Clip-maker',
  // Değişikliklerin kaydedildiği dal (deponun varsayılan dalı; Vercel buradan yayınlar)
  branch: 'claude/ecstatic-tesla-c0znbc',
  // GitHub Pages bu daldan yayınlanıyor; her kayıttan sonra aynı sürüme eşitlenir
  mirrorBranches: ['claude/clip-layout-social-media-19i1sx'],
  photoDir: 'foto',
  musicDir: 'muzik',
  maxPhotoPx: 1600,
  photoQuality: 0.85,
  maxMusicMB: 15,
};
