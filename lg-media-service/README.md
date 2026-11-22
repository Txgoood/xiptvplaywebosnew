# XIPTV Play — LG Media Companion (Deneysel)

Bu servis **normal Android backend'ine eklenmez**. Ayrı Render web hizmeti olarak çalışır, yalnız LG webOS IPK tarafından çağrılır. Ana XIPTV Play API'si değişmez.

## Özellikler

- Xtream film/dizi akışından ses ve altyazı akışlarını `ffprobe` ile listeler (dil, codec, gerçek akış indeksleri).
- Seçilen ses akışını `-c:v copy -c:a copy` ile deneysel MPEG-TS olarak sunar. Bu yöntem yeniden kodlama yapmaz.
- **Yeni deneysel, yalnızca kullanıcı isteğiyle çalışan seçenek:** `/tracks` ile doğrulanmış film/dizi için `GET /compat/:token?start=0` üzerinden 640×360, 20 fps H.264 Baseline + AAC MPEG-TS akışı üretir. Tek eşzamanlı işlem, 15–300 sn ve 5–100 MB sınırı korunur; 4K içerik düşürülür, altyazı gömülmez. Bu özellik **henüz gerçek LG TV'de doğrulanmadı**; Render CPU/bant genişliği gideri oluşturabilir.
- Yazı tabanlı gömülü altyazıları deneysel WebVTT akışına dönüştürür; bitmap PGS/VobSub desteklenmez.
- **Otomatik Xtream sunucu doğrulaması:** Kullanıcı playlist adresini değiştirince LG uygulaması yeni adresi gönderir. Sunucu genel IP'ye çözülmeli ve Xtream API hesabı aktif olarak doğrulamalıdır. Yeni alan adını Render'a elle eklemek gerekmez. DNS özel ağ/yerel erişim ve HTTP yönlendirmeleri engellenir.
- Önceden izin verilen sağlayıcılar desteklenmeye devam eder. En fazla bir aktif inceleme ve bir aktif akış; 90 dakikalık rastgele oturum anahtarları.
- Videolar veya kullanıcı şifreleri diske kaydedilmez. 4K TS oynatma koduna dokunulmaz.

## Render kurulumu

Önce kullanıcının doğru Render çalışma alanı onayını ve ücretsiz/ücretli plan tercihlerini alın.

- Repo: `Txgoood/xiptvplay` — branch: `feature/lg-webos-tv`
- Root directory: repository root
- Runtime: Node 22
- Build command: `npm install --prefix lg-media-service --omit=dev`
- Start command: `node lg-media-service/server.mjs`
- Environment: `LG_MEDIA_ALLOWED_HOSTS` (isteğe bağlı eski sağlayıcılar; **boş bırakılabilir**), `LG_MEDIA_ALLOWED_ORIGINS=null`
- Otomatik kabul yalnızca `player_api.php` üzerinden **aktif Xtream hesap doğrulaması** ve genel DNS kontrolü başarılıysa gerçekleşir. Her yeni sağlayıcının API yapısı bunu desteklemeyebilir; doğrulanamazsa erişim güvenli biçimde reddedilir.
- Opsiyonel test sınırları: `LG_MEDIA_MAX_STREAM_SECONDS=120`, `LG_MEDIA_MAX_STREAM_MB=60`. Bunlar üst sınırı 5 dakika / 100 MB olacak şekilde kodda kısıtlıdır.
- `/health` erişilebilir olmalıdır. DNS özel ağlara çözülüyorsa istek reddedilir.

**Güvenlik notu:** Bu deneysel servis internetten erişilebilen sınırlı bir medya yardımcısıdır. Sunucu adına izin vermek tek başına erişim sağlamaz; ilk tanınmayan sağlayıcılarda aktif Xtream kimliği doğrulanır. FFmpeg işlemci, ağ ve bant genişliği sınırları vardır. Tam güvenlik değerlendirmesi ve eski LG cihaz uyumluluğu henüz tamamlanmadı.

**Maliyet:** Media dönüştürme (ses kopyalama bile) sürekli CPU, ağ ve bant genişliği kullanır. Render ücretsiz plan kısıtları/aktif kotası ayrı doğrulanmalı. Hiçbir hizmet kullanıcı onayı olmadan ücretli plana geçirilmemelidir.

## Deneme ve uyumluluk

`node --test lg-media-service/test.mjs`

`POST /tracks` JSON `{serverUrl,username,password,kind:'series',id:'123',extension:'mkv'}` → `token`, `tracks`.

`GET /stream/:token/:audioIndex?start=180` → copy-only MPEG-TS (en fazla bir aktif akış).

`GET /subtitle/:token/:subtitleIndex.vtt` → WebVTT (yalnız yazı altyazı).

`GET /compat/:token?start=0` → Kullanıcı isteğiyle H.264 Baseline + AAC düşük çözünürlüklü deneme akışı (yalnız film/dizi; analiz oturumu gerekli).

Video oynatımının webOS 2.2.3'te başarısı gerçek televizyonda doğrulanmalıdır. Dosya çözme veya DRM atlatma desteği yoktur.

## HLS VOD analiz desteği (v1.0.80)

- Yalnız film/dizi için .m3u8 Xtream kaynağı /tracks analizinde kabul edilir; canlı TV bu servise yönlendirilmez.
- HLS manifestindeki varyant, segment, altyazı ve AES anahtar URI'leri FFmpeg için localhost relay biletleriyle değiştirilir. Her istekte güvenli DNS/IP kontrolü uygulanır.
- FFprobe çökmesi ve medya türü sınırlı şekilde ele alınır. HTTP 200 codec uyumluluğunu kanıtlamaz.
- /compat-mp4/prepare sadece 8 saniyelik H.264/AAC deneysel video üretir; tam film değildir.
- Bu repo güncellense bile xiptvplay-lg-media.onrender.com servisi otomatik güncellenmez; gerçek Render kaynak depo/dal doğrulanmalı ve LG servisi ayrı yayımlanmalıdır. Android uygulamasına dokunmayın.
