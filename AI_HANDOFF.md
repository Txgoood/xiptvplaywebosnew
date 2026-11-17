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
- `webos/build.mjs`: IPK paket klasörünü oluşturur, `appinfo.json` sürümü 1.0.19.
- `.github/workflows/build-webos.yml`: **Build LG webOS IPK**.

## Öncelikli hata
**v1.0.21:** v1.0.20 sonrası kullanıcı yine "köprü yok" mesajını gördü; mesaj iki pakette aynı olduğundan hangi paketin açıldığı belli değildi. v1.0.21 `paket=` alanı, `PalmSystem` ve window anahtarlarını gösterir. Native pakette de köprü yoksa luna yolu bu TV'de kapalıdır; kalan seçenekler: sunucuda ffmpeg ile ses parçası seçerek yeniden paketleme (Render sağlayıcıya erişebilmeli, tek bağlantı sınırı!) ya da istemcide JS ile MKV→fMP4 dönüştürüp MSE'ye beslemek (büyük ve doğrulanamaz iş).

**v1.0.20 (TV geri bildirimi):** v1.0.19'da TV `PalmServiceBridge=undefined` gösterdi: `trustLevel:"netcast"` bu köprüyü kaldırıyor (https://www.webosbrew.org/develop/guides/appinfo). Netcast modu CORS'u kapattığı için ana paketin IPTV istekleri buna bağlı. v1.0.20 ikinci bir "Native" paket (varsayılan güven seviyesi) üretir; orada luna ile liste (`getPipelineState`) ve seçim (`selectTrack`, type `audio`/`text`, index 0..n; kaynak: https://gist.github.com/aabytt/bddbb1bcf031a050d89a89aeee3a6737) denenir. Doğrulanmadı: (1) Native pakette katalog/CORS çalışıyor mu, (2) uygulama `com.webos.media` servisine erişebiliyor mu (ACG), (3) eski webOS'ta `selectTrack` var mı ve altyazıyı çiziyor mu. Ekrandaki luna yanıtı/hata metni bir sonraki adımın temelidir. HTML5 `audioTracks` webOS TV 3.0+ özelliğidir; bu TV'de yoktur.

**v1.0.19 (TV geri bildirimi):** v1.0.18'de MKV parça listesi TV'de göründü (9 ses/38 altyazı). Seçim, `typeof PalmServiceBridge==='function'` kontrolü yüzünden "erişilebilir değil" diyordu (eski WebKit `'object'` dönebilir). v1.0.19 doğruluk değeriyle algılar ve `selectTrack` gönderir. Hâlâ doğrulanmadı: TV'nin bu MKV'de ses değişimini/altyazı çizimini gerçekten yapıp yapmadığı. Ekranda çıkan luna yanıtı/hata metni (ve köprü yoksa `bridgeInfo` satırı) bir sonraki adımın temelidir. Altyazı verisini kendimiz çizmek, tüm dosyanın okunmasını gerektirir (MKV altyazıları cluster'lara dağılmıştır) ve tek bağlantılı hesapta oynarken mümkün değildir.

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

## 2026-11-15 — v1.0.45 geliştirme devri (42 kullanıcı seçimi)
**Güncel sürüm:** webos/build.mjs = 1.0.45. Android deposu değiştirilmedi. GitHub Actions workflow push ile tetiklenir; başarılı derlemeyi Actions sayfasından kontrol et. Kullanıcı TV modeli: LG 49UF8507-ZB (webOS 2.0). Tüm yeni özellikler kullanıcı TV'sinde henüz uçtan uca test edilmedi.

### Uygulanan / koda bağlanan özellikler
- v1.0.34: fullscreen kanal P+/P-, yön tuşu yedeği ve mavi tuş tam ekran.
- v1.0.35: çocuk/aile öneri rafları ve doğrulanmış giriş sonrası küçük ana ekran önbelleği.
- v1.0.36: özel tam ekran oynatıcı kontrolleri, ses/altyazı/hız menüleri ve kısa uyarılar; oynatıcı motoru korunuyor.
- v1.0.37: 6 büyük dikey poster ve D-pad yatay/dikey raf gezintisi.
- v1.0.38: çocuk profili için ebeveyn onay listesi; katalog erişiminde ve oynatmada izin kontrolü; izleme yüzdesi ve izlendi etiketi; poster boyutu ve ana ekran raf sırası; Çocuk TV butonu; numarayla kanal, önceki kanal ve manuel katalog yenilemesi; Actions build numarası.
- v1.0.39: tv-metadata.js ile mevcut Render /api/tmdb/details ve /api/tmdb/age-check servislerine isteğe bağlı erişim, afiş fallback, film detayları ve yaş sertifikasıyla filtrelenen aile/yaş rafları.
- v1.0.40: sezon/bölüm sıralama, bölüm izleme takibi ve sıradaki bölümü öneren panel; yeni bölüm sayısı artışını dizi ayrıntısı açıldığında saptama.
- v1.0.41: canlı TV yan kanal listesi (yeşil kumanda tuşu), kumanda yardım paneli.
- v1.0.42: yıl/tür/puan arama filtreleri, puan sıralaması ve favori kanal sıralama.
- v1.0.43: çocuk profili sadeleşmesi, ebeveyn izni yoksa eski hero görselini gizleme, haftalık aile önerisi sırası, uygulamanın çizdiği altyazı için stil ayarları.
- v1.0.44: yeni eklenen film/dizi rafları, önceki katalogla sınırlı kimlik karşılaştırması.
- v1.0.45: TMDb koleksiyon filmleri (katalog adları eşleşirse), kaynak oyuncu alanı varsa oyuncu keşfi, kategoriye göre benzer içerikler, film/dizi kataloglarında afiş fallback.

### Kritik sınırlamalar ve sıradaki doğrulama
- TMDb çağrıları Render sunucusundaki TMDB anahtarına ve API'nin yayında olmasına bağlıdır. Servis 503/404 verdiğinde arayüz oynatmayı bozmaz; **yaş verisi doğrulanmamış eserler aile rafına alınmaz.**
- Çocuk profili izin listesi güvenli varsayımla başta boştur. Yetişkin profili katalog kartındaki **Çocuğa izin** düğmesiyle içerik seçer. Kullanıcının seçmediği yetişkin PIN zorunluluğu otomatik eklenmedi; PIN'siz yetişkin profiline geçiş ayrıca risk olabilir.
- Yerel TV ses/altyazı medyası webOS 2.0 API erişimine bağlı; yalnızca uygulama çizimi altyazı boyut/konum ayarlarına uyar.
- TMDb afiş tamamlama sınırlandırılmış istek kuyruğu kullanır (oturum başına maksimum 24 metadata sorgusu). Katalogdaki tüm eksik posterlerin garantili tamamlanması beklenmez.
- IMDb puanı, yıl, tür, oyuncu arama ve keşif Xtream kaynak alanları mevcutsa işler; tüm sağlayıcılar bu alanları iletmez.
- Yeni dizi bölümü tespiti yalnızca dizinin ayrıntı verisi açıldığında eski sayıyla karşılaştırılır. Yeni film/dizi tespiti en fazla ilk 1800 film / 1000 dizi kimliğiyle çalışır.
- TMDb film serisi ve oyuncu keşfi ancak doğrulanabilir başlık/oyuncu eşleşmesinde sonuç verir; benzer içerik şu an aynı IPTV kategorisine dayanır, TMDb tabanlı tam benzerlik algoritması değildir.
- Gerçek LG TV üzerinde doğrulama öncelikleri: açılış/katalog, çocuk onay seçimi, poster kaydırma, ses/sub menüsü, P+/P-, mavi/yeşil/sarı tuş, numara tuşları, dizi bölüm seçimi/sonraki bölüm, yeni afişler ve altyazı konumu.
- GitHub Actions'ı başarılı görmek **TV'de çalıştı** demek değildir; test edilmemiş özellikleri test edildi diye bildirme.

## 2026-11-17 — v1.0.57 ayarlar konumu
- `webos/tv-catalog-redesign.css`: eski sidebar left/bottom kuralları üst menüdeki Ayarlar düğmesini logoya bindiriyordu. Düğme sağ üst köşeye sabitlendi, menüde 130 px sağ boşluk ayrıldı. Ayarlar paneli sağda düğmenin altında açılır.
- Sürüm build.mjs, legacy-index.html ve Actions doğrulamalarında 1.0.57 olarak eşleştirildi.
- Oynatma/katalog mantığı değiştirilmedi. CI #190 başarılı: medya testleri, paket doğrulaması, kumanda/oynatıcı smoke testleri ve her iki IPK üretimi geçti. Gerçek LG TV'de yerleşim ve kumandayla Ayarlar aç/kapat doğrulanmalı. Yerel tarayıcı görsel testi ortam kısıtı nedeniyle çalıştırılamadı.

- v1.0.57 kaynak commit: `beb1b9f8625aade080f0879c441fc861731ad9dd`. Ana IPK: https://github.com/Txgoood/xiptvplaywebosnew/actions/runs/44163821612/artifacts/14363384387 (Build #190).
