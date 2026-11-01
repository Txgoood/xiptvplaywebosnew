# XIPTV Play — LG webOS (ayrı proje)

Bu depo yalnızca LG webOS Smart TV uygulaması ve onun opsiyonel FFprobe/FFmpeg medya analiz servisi içindir. Android APK projesi bu depoda yer almaz.

## Derleme
GitHub Actions → **Build LG webOS IPK** → Run workflow. Başarılı çalıştırmanın artifact'i `xiptvplay-lg-webos-ipk` içindeki `.ipk` dosyasıdır.

Sürüm: **1.0.16** (ilk bağımsız depo aktarımı). Mevcut oynatıcı varsayılandır; Shaka yalnızca HLS/DASH için isteğe bağlıdır.

## Bilinen açık sorunlar
- MKV içindeki gömülü ses ve altyazı kanalları bazı LG TV'lerde listelenmiyor. `webos/tv-lg-media.js` ve `lg-media-service/server.mjs` üzerinden inceleyin. Bu servis ayrı dağıtım gerektirir; koddaki URL'nin canlı olması garanti değildir.
- Bazı dizi afişleri (örn. Söz) eksik geliyor.
- Tüm değişiklikler LG TV üzerinde doğrulanmadı; eski oynatıcıyı silmeyin.

## Kaynak ve geçmiş
Kaynak: `Txgoood/xiptvplay` deposu, `feature/lg-webos-tv` dalı, `9acdaf88d187b6bd9a2ffa3d02c97c4e040f3e7e` commit'i. Önceki deneme ve IPK iş akışı geçmişi GitHub tarafından otomatik olarak başka depoya taşınmaz; geçmiş incelemesi için eski depodaki **Build LG webOS IPK** çalıştırmalarına bakın. #272 afişleri çalışan referans denemeydi.

Android çalışması: https://github.com/Txgoood/xiptvplay
