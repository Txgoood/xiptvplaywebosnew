# XIPTV Play — LG webOS (ayrı proje)

Bu depo yalnızca LG webOS Smart TV uygulaması ve onun opsiyonel FFprobe/FFmpeg medya analiz servisi içindir. Android APK projesi bu depoda yer almaz.

## Derleme
GitHub Actions → **Build LG webOS IPK** → Run workflow. Başarılı çalıştırmanın artifact'i `xiptvplay-lg-webos-ipk` içindeki `.ipk` dosyasıdır.

Sürüm: **1.0.19**. Mevcut oynatıcı varsayılandır; Shaka yalnızca HLS/DASH için isteğe bağlıdır.

## 1.0.19 — Ses/altyazı seçimi TV'ye iletilir
TV'de 1.0.18 ile liste geldi (9 ses, 38 altyazı) ama seçim "webOS medya servisi bu uygulamada erişilebilir değil" hatasıyla reddedildi. Neden: eski webOS WebKit'i `PalmServiceBridge` gibi yerel nesneler için `typeof` olarak `'function'` yerine `'object'` döndürebiliyor; kod köprüyü yok sanıyordu (aynı hata "TV medya kanallarını tara" düğmesinde de vardı). Artık köprü doğruluk değeriyle algılanır. Seçim `luna://com.webos.media/selectTrack` ile gönderilir (ses: `audio`; altyazı: `text`, olmazsa `subtitle`; ardından en iyi çaba `setSubtitleEnable`). Altyazı "Kapalı" seçilince `setSubtitleEnable false` gönderilir. Menü yenilense de seçilen altyazı korunur. TV komutu reddederse gerçek hata metni ekranda gösterilir. **TV üzerinde doğrulanmamıştır.**

## 1.0.18 — MKV başlığı oynatmadan önce okunur
TV'de 1.0.17 ile IPTV sunucusu parça listesi isteğine HTTP 404 döndürdü, Render servisi de aynı kaynağı açamadı. Olası neden: hesap tek eşzamanlı bağlantıya izin veriyor ve oynayan yayın bağlantıyı tutuyor. Bu yüzden: (1) önceki yayın kapatılır, (2) MKV başlığı oynatmadan ÖNCE okunur (en fazla ~7 sn, başarısız olsa da oynatma başlar), (3) Render servisi artık otomatik taranmaz (ikinci bağlantı yayını kesebilir; düğmeyle elle çalışır), (4) hata mesajı sunucu adı, yönlendirme ve yanıt metnini gösterir (kimlik bilgisi asla gösterilmez). Bu hâlâ TV'de doğrulanmamıştır.

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
