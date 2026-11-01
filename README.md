# XIPTV Play — LG webOS (ayrı proje)

Bu depo yalnızca LG webOS Smart TV uygulaması ve onun opsiyonel FFprobe/FFmpeg medya analiz servisi içindir. Android APK projesi bu depoda yer almaz.

## Derleme
GitHub Actions → **Build LG webOS IPK** → Run workflow. Başarılı çalıştırmanın artifact'i `xiptvplay-lg-webos-ipk` içindeki `.ipk` dosyasıdır.

Sürüm: **1.0.17**. Mevcut oynatıcı varsayılandır; Shaka yalnızca HLS/DASH için isteğe bağlıdır.

## 1.0.17 — MKV ses/altyazı listesi
- Yeni `webos/tv-mkv-tracks.js`: MKV/WebM dosyasının başlığını TV üzerinde tek bir HTTP Range isteğiyle okur ve ses/altyazı parçalarını (dil, ad, codec, kanal) “MKV:” öneki ile menüye ekler. Harici servise ve TV'nin `audioTracks/textTracks` bildirmesine bağlı değildir.
- Parça seçimi TV medya motoruna (`luna://com.webos.media/selectTrack`) iletilir; ses değişiminden sonra oynatma ilerlemezse önceki ses parçasına otomatik dönülür. **TV üzerinde doğrulanmamıştır.**
- `webos/tv-lg-media.js`: Render servisi için uyandırma/yeniden deneme (soğuk başlangıç), 70 sn analiz zaman aşımı, menüde yinelenen girdilerin giderilmesi.
- `webos/tv-features.js`: yeni menü değer önekleri (`mkv:`, `native:`, `hls:`) artık mevcut yerel ses/altyazı parçalarını yanlışlıkla kapatmıyor.

## Bilinen açık sorunlar
- MKV içindeki parçalar artık listelenir; ancak seçimin TV üzerinde gerçekten uygulanıp uygulanmadığı cihazda doğrulanmalıdır. Harici servis (`lg-media-service`) ayrı dağıtım gerektirir; koddaki URL'nin canlı olması garanti değildir.
- Bazı dizi afişleri (örn. Söz) eksik geliyor.
- Tüm değişiklikler LG TV üzerinde doğrulanmadı; eski oynatıcıyı silmeyin.

## Kaynak ve geçmiş
Kaynak: `Txgoood/xiptvplay` deposu, `feature/lg-webos-tv` dalı, `9acdaf88d187b6bd9a2ffa3d02c97c4e040f3e7e` commit'i. Önceki deneme ve IPK iş akışı geçmişi GitHub tarafından otomatik olarak başka depoya taşınmaz; geçmiş incelemesi için eski depodaki **Build LG webOS IPK** çalıştırmalarına bakın. #272 afişleri çalışan referans denemeydi.

Android çalışması: https://github.com/Txgoood/xiptvplay
