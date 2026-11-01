# Başka Yapay Zekâya Teknik Devir — XIPTV Play LG webOS

## Kapsam ve sınır
Bu depo sadece **LG webOS Smart TV IPK** içindir. Android koduna, Android APK derlemelerine, orijinal `Txgoood/xiptvplay` reposuna dokunmayın. Proje LG webOS 2 (eski ES5 tarayıcı) hedefiyle derleniyor.

## Ana yollar
- `webos/legacy-index.html`: TV arayüzü, oynatıcı ve ses/altyazı seçim öğeleri.
- `webos/tv-iptv.js`: Xtream katalogları, MKV/MP4/TS oynatma URL'leri.
- `webos/tv-features.js`: `video.audioTracks`, `video.textTracks`, menü ve TV medya API taraması.
- `webos/tv-mkv-tracks.js`: (v1.0.17) MKV başlığını Range isteğiyle TV üzerinde okuyup ses/altyazı listesini menüye ekler; seçim `luna://com.webos.media/selectTrack` ile denenir (cihazda doğrulanmadı). Testi: `node webos/mkv-tracks.test.mjs`.
- `webos/tv-lg-media.js`: uzaktaki FFprobe ses/altyazı taraması, MKV için altyazı WebVTT, alternatif ses akışı ve geri dönüş.
- `webos/lg-media-config.js`: alternatif LG medya servisi adresi. Servisin yayında/erişilebilir olduğuna dair kanıt yok; önce `/health` doğrulayın.
- `lg-media-service/server.mjs`: ayrı medya analiz servisinin kaynakları. Android backend'inden farklıdır; doğrulanmış Xtream hesapları, SSRF korumaları ve FFprobe içerir.
- `webos/tv-alt-player.js`: Shaka yalnızca HLS/DASH denemesi (MKV'yi doğrudan açmaz), geri dönüş mekanizması.
- `webos/tv-home.js`: ana sayfa, devam et ve kartlar.
- `webos/build.mjs`: IPK paket klasörünü oluşturur, `appinfo.json` sürümü 1.0.18.
- `.github/workflows/build-webos.yml`: **Build LG webOS IPK**.

## Öncelikli hata
**v1.0.18 (TV geri bildirimi):** v1.0.17'de TV'deki okuyucu "IPTV sunucusu HTTP 404 döndürdü" mesajı verdi ve Render servisi "Medya analizi başarısız oldu" döndürdü; yani sağlayıcı ikinci istemcilere yanıt vermiyor. En güçlü hipotez: tek eşzamanlı bağlantı sınırı (oynayan yayın bağlantıyı tutuyor). v1.0.18 başlığı oynatmadan önce okur ve Render'ı otomatik çalıştırmaz. Hipotez doğrulanmadı; 404 oynatma başlamadan önce de sürerse sebep User-Agent/Origin filtresi gibi başka bir şeydir ve ekrandaki yeni teşhis mesajına (sunucu adı, yönlendirme, yanıt metni) bakılmalıdır.

**v1.0.17 güncellemesi:** Kök neden: MKV parça listesi yalnızca (a) TV'nin HTML5 `audioTracks/textTracks` bildirmesine, (b) Render'daki ücretsiz servisin cevap vermesine bağlıydı (soğuk başlangıç + 28 sn zaman aşımı + tek deneme). İkisi de başarısız olunca menü boş kalıyordu. v1.0.17 başlığı TV üzerinde okur (`tv-mkv-tracks.js`). Parça *seçiminin* gerçek TV'de çalıştığı hâlâ doğrulanmadı.

Eski not: Diğer IPTV uygulamalarında aynı MKV kaynağının çoklu ses/altyazı akışları görünürken bizim uygulamada hiç görünmüyor. Türkçe otomatik seçim v1.0.16'da devre dışı bırakıldı. Seçim menüsüne ulaşan parçaları ve ayrı medya servisinin HTTP hata/yanıtlarını ayrıştırın. Sadece HTML5 `audioTracks/textTracks` boş olduğunda MKV'de gerçek parça yok varsaymayın. Servis çalışmıyorsa FFprobe analizinin mümkün olmayacağını unutmayın. TV üzerinde test edilmeden çözülmüş demeyin.

## Diğer bilinen hatalar
- Bazı dizi afişleri (özellikle 'Söz') boş; #272 referans build'de afişler kullanıcıya göre büyük ölçüde çalışıyordu.
- Bazı denemelerde GitHub Actions hataları yaşandı. Logs üzerinden doğrulayın.
- Oynatıcı değiştirirken çalışan eski oynatıcıyı silmeyin; tek tuşla geri dönüşü koruyun.

## Derleme/sürüm kuralı
Her IPK'da `webos/build.mjs` sürümü, `legacy-index.html` Ayarlar sürüm metni ve GitHub Actions run-name eşleşmeli. Yanıtta **IPK sürümü + GitHub Actions #numarası + artifact bağlantısı** verin; doğrulanmamış derlemeyi başarılı ilan etmeyin.

## Geçmiş
Kaynak dal: https://github.com/Txgoood/xiptvplay/tree/feature/lg-webos-tv
Eski IPK geçmişi: https://github.com/Txgoood/xiptvplay/actions/workflows/build-webos.yml
Yeni IPK derlemeleri: https://github.com/Txgoood/xiptvplaywebosnew/actions/workflows/build-webos.yml
Bu depo, eski dalın 1.0.16 anlık görüntüsünün webOS'a ait dosyalarından oluşturuldu; eski GitHub Actions run/artifact geçmişi GitHub'da bu depoya otomatik taşınmaz. Önceki denemeleri eski depodan okuyun.
